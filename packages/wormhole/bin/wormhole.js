const aws4 = require('aws4')
const awscred = require('awscred')
const { program } = require('commander')
const WebSocket = require('ws')
const ReconnectingWebSocket = require('reconnecting-websocket')
const https = require('https')
const queryString = require('query-string')
const axios = require('axios')
const AWS = require('aws-sdk')
const { Stream, PassThrough } = require('stream')
const crypto = require('crypto')

const MAX_SINGLE_FRAME_CONTENT_LENGTH = 1024 * 24 // hard max 32kb

const parsePort = (value, dummyPrevious) => {
  const parsedValue = parseInt(value, 10)
  if (isNaN(parsedValue)) {
    throw new commander.InvalidArgumentError('Not a number.')
  }
  return parsedValue
}

const streamToWs = (ws, sourceConnectionId, reqId, res) => {
  console.log('streaming to ws')
  const chunks = []
  const stream = res.data

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      let buf = Buffer.from(chunk)
      if (buf.length > MAX_SINGLE_FRAME_CONTENT_LENGTH) {
        let o = 0, n = buf.length;
        while (o < n) {
          const slicedBuf = buf.slice(o, o += MAX_SINGLE_FRAME_CONTENT_LENGTH)
          console.debug('sending smaller chunk (%s)', slicedBuf.length)
          ws.send(
            JSON.stringify({
              action: 'sendmessage',
              connectionId: sourceConnectionId,
              data: {
                reqId,
                bodyChunkIndex: chunks.length,
                bodyChunk: slicedBuf.toString('base64'),
              },
            }),
          )
          chunks.push(slicedBuf)
        }
      } else {
        console.debug('sending chunk (%s)', buf.length)
        ws.send(
          JSON.stringify({
            action: 'sendmessage',
            connectionId: sourceConnectionId,
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
    stream.on('error', (err) => reject(err))
    stream.on('end', () => {
      console.debug('sending end chunk (total chunks: %s)', chunks.length)
      ws.send(
        JSON.stringify({
          action: 'sendmessage',
          connectionId: sourceConnectionId,
          data: {
            reqId,
            endBodyChunk: true,
            totalChunks: chunks.length,
            res: {
              status: res.status,
              headers: res.headers,
            },
          },
        }),
      )
      resolve(Buffer.concat(chunks).toString('base64'))
    })
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

  console.log('Fetching wormhole config')
  const wormholeConfigUrl = `https://${endpointUrl.host}/wormholeConfig`
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
      const ws = new ReconnectingWebSocket(signedWsEndpoint, [], { WebSocket })

      ws.addEventListener('open', async () => {
        console.log('Connected to websocket')
      })
      ws.addEventListener('close', async () => {
        console.log('Disconnected from websocket')
      })
      ws.addEventListener('message', async (e) => {
        try {
          const parsedMessage = JSON.parse(e.data)
          console.log(
            new Date(),
            'Received message from websocket',
            parsedMessage,
          )
          const { sourceConnectionId, data } = parsedMessage

          if (data.req) {
            const {
              reqId,
              req: {
                sourceIp,
                headers,
                originalUrl,
                method,
                body,
                // bodyS3Key,
              },
            } = data

            const baseUrl = `${scheme}://${localhost}:${port}${originalUrl}`

            console.log(new Date(), 'Proxying request to', baseUrl, originalUrl)

            let headRes
            if (method === 'GET') {
              try {
                headRes = await axios.head(baseUrl, {
                  headers,
                  validateStatus: function (status) {
                    return (status >= 200 && status < 300) || status === 304
                  },
                  withCredentials: true,
                })
                console.log('HEAD', headRes.status, headRes.headers)
              } catch (e) {
                console.debug('Could not HEAD')
              }
            }

            if (headRes?.status === 304) {
              console.log('sending 304 response from HEAD', reqId)
              return sendWsResponse(ws, sourceConnectionId, reqId, headRes)
            }

            // console.log(method, baseUrl, headers, body, Buffer.from(body, 'base64'));
            // TODO nocache if headers.cookie, headers.authorization, method != GET, or nocache option
            // TODO skip HEAD option

            let res
            try {
              res = await axios({
                method,
                url: baseUrl,
                timeout: 10000,
                headers,
                responseType: 'stream',
                decompress: false,
                validateStatus: (status) => true,
                withCredentials: true,
                data: body && Buffer.from(body, 'base64'),
              })
            } catch (e) {
              console.error('ERROR fetching request for', e)
              sendWsResponse(ws, sourceConnectionId, reqId, {
                status: 500,
                headers: {},
              })
            }

            console.log(
              new Date(),
              'response received',
              baseUrl,
              res.status,
              reqId,
            )

            if (res.status === 304) {
              console.log('sending 304 response', reqId)
              sendWsResponse(ws, sourceConnectionId, reqId, res)
            } else {
              console.log(
                'cache headers',
                res.headers['content-type'],
                res.headers['content-length'],
                res.headers['etag'],
                res.headers['cache-control'],
              )

              let contentLength = parseInt(
                res.headers['content-length'] ||
                  (headRes?.headers || {})['content-length'],
                10,
              )

              const contentType = res.headers['content-type']
              const shouldStreamBody = !!(
                contentType &&
                contentType.match(/(^text\/html)|(^application\/json)/i)
              )

              console.log(shouldStreamBody, contentLength, contentType)

              if (
                contentLength &&
                contentLength < MAX_SINGLE_FRAME_CONTENT_LENGTH
              ) {
                sendWsResponse(
                  ws,
                  sourceConnectionId,
                  reqId,
                  res,
                  await streamToBase64(res.data),
                )
              } else if (shouldStreamBody) {
                await streamToWs(ws, sourceConnectionId, reqId, res)
              } else {
                const cacheKey = res.headers['etag']
                  ? crypto
                      .createHash('sha256')
                      .update(`${baseUrl}$$${res.headers['etag']}`)
                      .digest('hex')
                  : reqId
                const cacheS3Key = `responses/${cacheKey}`

                let cacheKeyExists = false
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

                if (cacheKeyExists) {
                  console.debug('serving previously cached key')
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
                    'uploading response to s3',
                    reqId,
                    startUploadTime,
                  )

                  res.data.pipe(passThrough)

                  return promise
                    .then((result) => {
                      console.log(
                        new Date(),
                        'done, sending response for',
                        reqId,
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
      })
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
