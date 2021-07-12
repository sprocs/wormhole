const aws4 = require('aws4')
const awscred = require('awscred')
const { program } = require('commander')
const WebSocket = require('ws')
const ReconnectingWebSocket = require('reconnecting-websocket')
const https = require('https')
const queryString = require('query-string')
const axios = require('axios')
const { Stream, PassThrough } = require('stream')
const crypto = require('crypto')
const AWS = require('aws-sdk')
const ssm = new AWS.SSM()

const MAX_SINGLE_FRAME_CONTENT_LENGTH = 24 * 1024 // hard max 32kb
const MAX_WS_STREAMABLE_LENGTH = 100 * 1024 // limit websocket streams to 100kb

let reqBodyChunks = {}
let reqBodyEndRes = {}

const parsePort = (value, dummyPrevious) => {
  const parsedValue = parseInt(value, 10)
  if (isNaN(parsedValue)) {
    throw new commander.InvalidArgumentError('Not a number.')
  }
  return parsedValue
}

const streamBodyToWs = (ws, connectionId, reqId, endData = {}, stream) => {
  let chunks = []
  let chunkQueue = []
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      let buf = Buffer.from(chunk)
      const chunkQueueBufLength = chunkQueue.reduce(
        (accumulator, currentValue) => {
          return accumulator + currentValue.length
        },
        0,
      )

      if (
        chunkQueue.length > 0 &&
        buf.length + chunkQueueBufLength < MAX_SINGLE_FRAME_CONTENT_LENGTH
      ) {
        // if queue is in progress, continue adding
        console.debug('queuing chunk (%s)', buf.length)
        chunkQueue.push(buf)
        return // wait for end or next chunk
      } else if (chunkQueue.length > 0) {
        // send queue
        const newChunk = Buffer.concat(chunkQueue)
        console.debug('sending queued chunks (%s)', newChunk.length)
        ws.send(
          JSON.stringify({
            action: 'sendmessage',
            connectionId,
            data: {
              reqId,
              bodyChunkIndex: chunks.length,
              bodyChunk: newChunk.toString('base64'),
            },
          }),
        )
        chunkQueue = []
        chunks.push(newChunk)
        // continue
      }

      if (buf.length > MAX_SINGLE_FRAME_CONTENT_LENGTH) {
        let o = 0,
          n = buf.length
        while (o < n) {
          const slicedBuf = buf.slice(o, (o += MAX_SINGLE_FRAME_CONTENT_LENGTH))
          console.debug('sending smaller chunk (%s)', slicedBuf.length)
          ws.send(
            JSON.stringify({
              action: 'sendmessage',
              connectionId,
              data: {
                reqId,
                bodyChunkIndex: chunks.length,
                bodyChunk: slicedBuf.toString('base64'),
              },
            }),
          )
          chunks.push(slicedBuf)
        }
      } else if (buf.length < MAX_SINGLE_FRAME_CONTENT_LENGTH / 2) {
        console.debug('queuing small chunk (%s)', buf.length)
        chunkQueue.push(buf)
        return
      } else {
        console.debug('sending chunk (%s)', buf.length)
        ws.send(
          JSON.stringify({
            action: 'sendmessage',
            connectionId,
            data: {
              reqId,
              bodyChunkIndex: chunks.length,
              bodyChunk: buf.toString('base64'),
            },
          }),
        )
        chunks.push(buf)
      }
    })
    stream.on('end', () => {
      if (chunkQueue.length > 0) {
        const newChunk = Buffer.concat(chunkQueue)
        console.debug('sending queued chunks with end (%s)', newChunk.length)
        ws.send(
          JSON.stringify({
            action: 'sendmessage',
            connectionId,
            data: {
              reqId,
              bodyChunkIndex: chunks.length,
              bodyChunk: newChunk.toString('base64'),
              endBodyChunk: true,
              totalChunks: chunks.length + 1,
              ...endData,
            },
          }),
        )
        chunkQueue = []
        chunks.push(newChunk)
      } else {
        console.debug('sending end chunk (total chunks: %s)', chunks.length)
        ws.send(
          JSON.stringify({
            action: 'sendmessage',
            connectionId,
            data: {
              reqId,
              endBodyChunk: true,
              totalChunks: chunks.length,
              ...endData,
            },
          }),
        )
      }
      resolve(Buffer.concat(chunks).toString('base64'))
    })
    stream.on('error', (err) => reject(err))
  })
}

const streamToBase64 = (stream) => {
  const chunks = []
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    stream.on('error', (err) => reject(err))
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('base64')))
  })
}

const uploadFromStream = (s3, res, fileName, bucket) => {
  const passThrough = new PassThrough()
  const promise = s3
    .upload({
      Bucket: bucket,
      Key: fileName,
      ContentType: res.headers['content-type'],
      ContentLength: res.headers['content-length'],
      Body: passThrough,
    })
    .promise()
  return { passThrough, promise }
}

const sendWsResponse = (
  ws,
  sourceConnectionId,
  reqId,
  res,
  body = null,
  s3Key = null,
) => {
  ws.send(
    JSON.stringify({
      action: 'sendmessage',
      connectionId: sourceConnectionId,
      data: {
        reqId,
        res: {
          status: res.status,
          headers: res.headers,
          s3Key,
          body,
        },
      },
    }),
  )
}

async function main() {
  program
    .option('-d, --debug', 'output extra debugging')
    .option(
      '-l, --localhost <host>',
      'local hostname to proxy against',
      'localhost',
    )
    .option('-s, --scheme <scheme>', 'local scheme to proxy against', 'http')
    .requiredOption(
      '-p, --port <port>',
      'local port to proxy requests against',
      parsePort,
    )
    .requiredOption('-e, --endpoint <https endpoint>', 'API Gateway endpoint')
    .version('0.0.1')

  await program.parseAsync(process.argv)

  const { endpoint, port, localhost, scheme } = program.opts()

  const endpointUrl = new URL(endpoint)

  console.log('Fetching wormhole config from', endpoint)
  let wormholeConfigUrl = `${endpointUrl.protocol}//${endpointUrl.host}/wormholeConfig`
  if (endpointUrl.username || endpointUrl.password) {
    wormholeConfigUrl = `${endpointUrl.protocol}//${
      endpointUrl.username || ''
    }:${endpointUrl.password || ''}@${endpointUrl.host}/wormholeConfig`
  }
  try {
    const {
      data: { wsEndpoint, bucket, region },
    } = await axios.get(wormholeConfigUrl)
    console.log(
      'Found websocket endpoint %s and bucket %s region %s',
      wsEndpoint,
      bucket,
      region,
    )

    const s3Client = new AWS.S3({ region })
    const wsEndpointUrl = new URL(wsEndpoint)

    console.log('Loading AWS credentials')
    awscred.load(function (err, data) {
      if (err) throw err

      var queryStringStr = queryString.stringify({
        'X-Amz-Security-Token': data.credentials.sessionToken,
        clientType: 'CLIENT',
        clientForHost: endpointUrl.host,
      })

      const { path } = aws4.sign(
        {
          host: wsEndpointUrl.host,
          path: `${wsEndpointUrl.pathname}?` + queryStringStr,
          service: `execute-api`,
          region: data.region,
          signQuery: true,
        },
        data.credentials,
      )

      const signedWsEndpoint = `wss://${wsEndpointUrl.host}${path}`

      console.log('Connecting to websocket')
      let ws = null

      const wsOnOpen = async () => {
        console.log('Connected to websocket')
      }

      const wsOnClose = async () => {
        console.log('Disconnected from websocket')
        setTimeout(() => {
          console.log('Attempting reconnect')
          wsConnect()
        }, 1000)
      }

      const wsOnMessage = async (e) => {
        try {
          const parsedMessage = JSON.parse(e.data)
          const { sourceConnectionId, data } = parsedMessage
          const {
            req,
            reqId,
            bodyChunk,
            bodyChunkIndex,
            endBodyChunk,
            totalChunks,
          } = data || {}

          if (reqId) {
            console.log(
              new Date(),
              reqId,
              'Received request from websocket',
              sourceConnectionId,
              req.sourceIp,
              req.method,
              endpointUrl.host,
              req.originalUrl,
            )

            if (!reqBodyChunks[reqId]) {
              reqBodyChunks[reqId] = []
            }

            if (bodyChunk) {
              console.debug(
                new Date(),
                reqId,
                `received bodyChunk[${bodyChunkIndex}]`,
                bodyChunk,
              )
              reqBodyChunks[reqId].push({
                bodyChunkIndex,
                chunk: Buffer.from(bodyChunk, 'base64'),
              })

              if (
                reqBodyEndRes[reqId] &&
                reqBodyChunks[reqId].length === reqBodyEndRes[reqId].totalChunks
              ) {
                console.debug(
                  new Date(),
                  reqId,
                  'received last bodyChunk having already received endBodyChunk',
                )
              } else {
                return false
              }
            }

            if (endBodyChunk) {
              reqBodyEndRes[reqId] = {
                req: parsedMessage.data.req,
                totalChunks,
              }

              if (
                reqBodyChunks[reqId].length !== reqBodyEndRes[reqId].totalChunks
              ) {
                console.debug(
                  new Date(),
                  reqId,
                  'received endBodyChunk but waiting for chunks to complete...',
                  reqBodyChunks[reqId].length,
                  reqBodyEndRes[reqId].totalChunks,
                )
                return false
              }
            }

            let reqMethod = null
            let reqOriginalUrl = null
            let reqHeaders = null
            let reqBody = null

            if (reqBodyEndRes[reqId]) {
              // handle as chunked body
              reqMethod = reqBodyEndRes[reqId].req.method
              reqOriginalUrl = reqBodyEndRes[reqId].req.originalUrl
              reqHeaders = reqBodyEndRes[reqId].req.headers
              let reqBodyBuf = []
              reqBodyChunks[reqId]
                .sort((a, b) => {
                  return a.bodyChunkIndex - b.bodyChunkIndex
                })
                .map(({ chunk }) => {
                  reqBodyBuf.push(chunk)
                })
              reqBody = Buffer.concat(reqBodyBuf)

              reqBodyChunks[reqId] = null
              reqBodyEndRes[reqId] = null
            } else {
              reqMethod = req.method
              reqOriginalUrl = req.originalUrl
              reqHeaders = req.headers
              reqBody = req.body && Buffer.from(req.body, 'base64')
            }

            const baseUrl = `${scheme}://${localhost}:${port}${reqOriginalUrl}`

            console.log(new Date(), reqId, 'Proxying request to', baseUrl)

            let headRes
            // if (method === 'GET') {
            //   try {
            //     headRes = await axios.head(baseUrl, {
            //       headers,
            //       validateStatus: function (status) {
            //         return (status >= 200 && status < 300) || status === 304
            //       },
            //       withCredentials: true,
            //     })
            //     console.log('HEAD', headRes.status, headRes.headers)
            //   } catch (e) {
            //     console.debug('Could not HEAD')
            //   }
            // }
            //
            // if (headRes?.status === 304) {
            //   console.log('sending 304 response from HEAD', reqId)
            //   return sendWsResponse(ws, sourceConnectionId, reqId, headRes)
            // }

            // console.log(method, baseUrl, headers, body, Buffer.from(body, 'base64'));
            // TODO nocache if headers.cookie, headers.authorization, method != GET, or nocache option
            // TODO skip HEAD option

            let res
            try {
              res = await axios({
                method: reqMethod,
                url: baseUrl,
                headers: reqHeaders,
                data: reqBody,
                responseType: 'stream',
                decompress: false,
                validateStatus: (status) => true,
                withCredentials: true,
                timeout: 10000,
                maxRedirects: 0,
              })
            } catch (e) {
              console.error('ERROR fetching request for', baseUrl, e.code)
              return sendWsResponse(ws, sourceConnectionId, reqId, {
                status: 503,
                headers: {},
              })
            }

            console.log(
              new Date(),
              reqId,
              'response received',
              baseUrl,
              res.status,
            )

            if (res.status === 304) {
              console.log(new Date(), reqId, 'sending 304 response')
              sendWsResponse(ws, sourceConnectionId, reqId, res)
            } else {
              console.log(
                new Date(),
                reqId,
                'cache headers',
                res.headers['content-type'],
                res.headers['content-length'],
                res.headers['etag'],
                res.headers['cache-control'],
                res.data?.readableLength,
              )

              let contentLength = parseInt(
                res.headers['content-length'] ||
                  (headRes?.headers || {})['content-length'],
                10,
              )

              const contentType = res.headers['content-type']
              const shouldStreamBody =
                (contentType &&
                  contentType.match(/(^text\/html)|(^application\/json)/i) &&
                  (!contentLength ||
                    contentLength < MAX_WS_STREAMABLE_LENGTH)) ||
                (contentLength && contentLength < MAX_WS_STREAMABLE_LENGTH)

              console.log(
                new Date(),
                reqId,
                shouldStreamBody,
                contentLength,
                contentType,
              )

              if (
                contentLength &&
                contentLength < MAX_SINGLE_FRAME_CONTENT_LENGTH
              ) {
                // If content-length is supplied and it is less than a WS single
                // frame, send as such
                console.log(
                  new Date(),
                  reqId,
                  'sending single frame response over websocket',
                )
                sendWsResponse(
                  ws,
                  sourceConnectionId,
                  reqId,
                  res,
                  await streamToBase64(res.data),
                )
              } else if (shouldStreamBody) {
                // If the content-type is a common low-filesize/high-use content-type (HTML or JSON from a webserver)
                // and either the content-type is unknown or is low enough to
                // stream reasonably
                console.log(
                  new Date(),
                  reqId,
                  'sending streamed response over websocket',
                )
                await streamBodyToWs(
                  ws,
                  sourceConnectionId,
                  reqId,
                  {
                    res: {
                      status: res.status,
                      headers: res.headers,
                    },
                  },
                  res.data,
                )
                // await streamToWs(ws, sourceConnectionId, reqId, res)
              } else {
                // Otherwise stream the response to S3 unless it is cachable
                // (etag present, no authorization header, no cookie, no
                // cache-control 0) and already present in S3 (expires daily)
                console.log(new Date(), reqId, 'sending response over s3')

                const cacheEligible = !(
                  res.headers['cache-control'] || ''
                ).match(/private/i)
                const cacheKey = res.headers['etag']
                  ? crypto
                      .createHash('sha256')
                      .update(`${baseUrl}$$${res.headers['etag']}`)
                      .digest('hex')
                  : reqId
                const cacheS3Key = `responses/${cacheKey}`

                let cacheKeyExists = false
                if (cacheEligible) {
                  try {
                    const existingCachedResponse = await s3Client
                      .headObject({
                        Bucket: bucket,
                        Key: cacheS3Key,
                      })
                      .promise()
                    cacheKeyExists = true
                  } catch (e) {
                    cacheKeyExists = false
                  }
                }

                if (cacheKeyExists) {
                  console.debug(
                    new Date(),
                    reqId,
                    'serving previously cached key',
                    cacheS3Key,
                  )
                  sendWsResponse(
                    ws,
                    sourceConnectionId,
                    reqId,
                    res,
                    null,
                    cacheS3Key,
                  )
                } else {
                  const { passThrough, promise } = uploadFromStream(
                    s3Client,
                    res,
                    cacheS3Key,
                    bucket,
                  )
                  const startUploadTime = new Date()
                  console.log(
                    new Date(),
                    reqId,
                    'uploading response to s3',
                    startUploadTime,
                  )

                  res.data.pipe(passThrough)

                  return promise
                    .then((result) => {
                      console.log(
                        new Date(),
                        reqId,
                        'sending s3 response key',
                        (new Date() - startUploadTime) / 1000,
                      )
                      sendWsResponse(
                        ws,
                        sourceConnectionId,
                        reqId,
                        res,
                        null,
                        result.Key,
                      )
                    })
                    .catch((e) => {
                      throw e
                    })
                }
              }
            }
          }
        } catch (e) {
          console.error(e)
        }
      }

      const wsConnect = () => {
        ws = new ReconnectingWebSocket(signedWsEndpoint, [], { WebSocket })
        ws.addEventListener('open', wsOnOpen)
        ws.addEventListener('close', wsOnClose)
        ws.addEventListener('message', wsOnMessage)
        return ws
      }

      wsConnect()
    })
  } catch (e) {
    console.error(
      'Error fetching wormhole config. Expected config at %s (%s)',
      wormholeConfigUrl,
      e.message,
    )
  }
}

;(async () => {
  await main()
})()
