const aws4 = require('aws4')
const awscred = require('awscred')
const WebSocket = require('ws')
const https = require('https')
const queryString = require('query-string')
const axios = require('axios')
const { Stream, Readable, PassThrough } = require('stream')
const crypto = require('crypto')
const consola = require('consola')
const chalk = require('chalk')
const prettyBytes = require('pretty-bytes')
const AWS = require('aws-sdk')

const MAX_SINGLE_FRAME_CONTENT_LENGTH = 26 * 1024 // hard max 32kb, space for headers
const MAX_WS_STREAMABLE_LENGTH = 100 * 1024 // limit websocket streams to 100kb
const PING_INTERVAL = 60 * 1000 // 60s

let reqBodyChunks = {}
let reqBodyEndRes = {}
let pingState = 0

const forceCloseClientConnections = async (logger, wormholeConfig, items) => {
  const wsApiGatewayClient = new AWS.ApiGatewayManagementApi({
    region: wormholeConfig.region,
    apiVersion: '2018-11-29',
    endpoint: wormholeConfig.wsEndpoint,
  })
  const documentClient = new AWS.DynamoDB.DocumentClient({
    region: wormholeConfig.region,
  })

  await Promise.all(
    items.map(async (connection) => {
      logger.info('deleting existing client connection', connection)
      await documentClient
        .delete({
          TableName: wormholeConfig.table,
          Key: {
            connectionId: connection.connectionId,
          },
        })
        .promise()

      try {
        logger.debug(
          'messaging deleted client connection',
          connection.connectionId,
        )
        await wsApiGatewayClient
          .postToConnection({
            ConnectionId: connection.connectionId,
            Data: JSON.stringify({
              action: 'FORCE_CLIENT_DISCONNECT',
            }),
          })
          .promise()
      } catch (e) {
        logger.debug(
          'could not message deleted client connection',
          connection.connectionId,
          e,
        )
      }
    }),
  )
}

const streamBodyToWs = (
  logger,
  ws,
  connectionId,
  reqId,
  endData = {},
  stream,
  maxWsSize,
) => {
  let chunks = []
  let chunkQueue = []
  let maxWsSizeExceeded = false
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      let buf = Buffer.from(chunk)
      const chunkQueueBufLength = chunkQueue.reduce(
        (accumulator, currentValue) => {
          return accumulator + currentValue.length
        },
        0,
      )
      const chunksBufLength = chunks.reduce((accumulator, currentValue) => {
        return accumulator + currentValue.length
      }, 0)

      if (!isNaN(maxWsSize) && chunksBufLength >= maxWsSize) {
        maxWsSizeExceeded = true
      }

      if (
        chunkQueue.length > 0 &&
        buf.length + chunkQueueBufLength < MAX_SINGLE_FRAME_CONTENT_LENGTH
      ) {
        // if queue is in progress, continue adding
        logger.debug('queuing chunk (%s)', buf.length)
        chunkQueue.push(buf)
        return // wait for end or next chunk
      } else if (chunkQueue.length > 0) {
        // send queue
        const newChunk = Buffer.concat(chunkQueue)
        if (!maxWsSizeExceeded) {
          logger.debug('sending queued chunks (%s)', newChunk.length)
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
        }
        chunkQueue = []
        chunks.push(newChunk)
        // continue
      }

      if (buf.length > MAX_SINGLE_FRAME_CONTENT_LENGTH) {
        let o = 0,
          n = buf.length
        while (o < n) {
          const slicedBuf = buf.slice(o, (o += MAX_SINGLE_FRAME_CONTENT_LENGTH))
          if (!maxWsSizeExceeded) {
            logger.debug('sending smaller chunk (%s)', slicedBuf.length)
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
          }
          chunks.push(slicedBuf)
        }
      } else if (buf.length < MAX_SINGLE_FRAME_CONTENT_LENGTH / 2) {
        logger.debug('queuing small chunk (%s)', buf.length)
        chunkQueue.push(buf)
        return
      } else {
        if (!maxWsSizeExceeded) {
          logger.debug('sending chunk (%s)', buf.length)
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
        }
        chunks.push(buf)
      }
    })
    stream.on('end', () => {
      if (chunkQueue.length > 0) {
        const newChunk = Buffer.concat(chunkQueue)
        if (!maxWsSizeExceeded) {
          logger.debug('sending queued chunks with end (%s)', newChunk.length)
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
        }
        chunkQueue = []
        chunks.push(newChunk)
      } else if (!maxWsSizeExceeded) {
        logger.debug('sending end chunk (total chunks: %s)', chunks.length)
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

      if (maxWsSizeExceeded) {
        resolve(['max websocket size exceeded', Buffer.concat(chunks)])
      } else {
        resolve([null, Buffer.concat(chunks).toString('base64')])
      }
    })
    stream.on('error', (err) => reject(err))
  })
}

const formatDuration = (start) => {
  return `${(new Date() - start) / 1000} s`
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
      CacheControl: res.headers['cache-control'],
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

const fetchWormholeConfig = async (logger, endpoint) => {
  const endpointUrl = new URL(endpoint)
  logger.info('fetching wormhole config from', endpoint)
  let wormholeConfigUrl = `${endpointUrl.protocol}//${endpointUrl.host}/wormholeConfig`
  if (endpointUrl.username || endpointUrl.password) {
    wormholeConfigUrl = `${endpointUrl.protocol}//${
      endpointUrl.username || ''
    }:${endpointUrl.password || ''}@${endpointUrl.host}/wormholeConfig`
  }
  try {
    const { data } = await axios.get(wormholeConfigUrl)
    const { wsEndpoint, bucket, region, table, host } = data
    logger.success(
      chalk`found websocket endpoint {underline ${wsEndpoint}} and bucket {underline ${bucket}} region {underline ${region}} table {underline ${table}}`,
    )
    return data
  } catch (e) {
    logger.error(
      'Error fetching wormhole config. Expected config at %s (%s)',
      wormholeConfigUrl,
      e.message,
    )
    throw e
  }
}

const wsListen = async (endpoint, localPort, options) => {
  consola.debug('listen command called', endpoint, localPort)
  const { localhost, scheme, debug, force, maxWsSize } = options

  const logger = consola.create({
    level: debug ? 4 : 3,
    defaults: {
      additionalColor: 'white',
    },
  })

  const wormholeConfig = await fetchWormholeConfig(logger, endpoint)
  const { wsEndpoint, bucket, region, host, table } = wormholeConfig

  const s3Client = new AWS.S3({ region })
  const wsEndpointUrl = new URL(wsEndpoint)

  logger.debug('ensuring no other clients for host')
  const documentClient = new AWS.DynamoDB.DocumentClient({
    region,
  })
  const clientsForHost = await documentClient
    .query({
      TableName: table,
      IndexName: 'byClientForHost',
      KeyConditionExpression: 'clientForHost = :clientForHost',
      ExpressionAttributeValues: { ':clientForHost': host },
    })
    .promise()

  if (clientsForHost.Items.length > 0) {
    consola.error(
      'found existing clients listening for host',
      clientsForHost.Items,
    )
    if (force) {
      await forceCloseClientConnections(
        logger,
        wormholeConfig,
        clientsForHost.Items,
      )
    } else {
      process.exit(1)
    }
  }

  logger.debug('loading AWS credentials')
  awscred.load(function (err, data) {
    if (err) {
      logger.error(
        'Could not load AWS credentials. Try using AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION or AWS_PROFILE.',
      )
      throw err
    }

    let queryStringStr = queryString.stringify({
      'X-Amz-Security-Token': data.credentials.sessionToken,
      clientType: 'CLIENT',
      clientForHost: host,
    })

    const generateSignedWsEndoint = () => {
      const { path } = aws4.sign(
        {
          host: wsEndpointUrl.host,
          path: `${wsEndpointUrl.pathname}?` + queryStringStr,
          service: `execute-api`,
          region: region || data.region,
          signQuery: true,
        },
        data.credentials,
      )
      return `wss://${wsEndpointUrl.host}${path}`
    }

    let signedWsEndpoint = generateSignedWsEndoint()

    logger.debug('connecting to websocket')
    let ws = null
    let pingInterval = null

    const pingServer = () => {
      logger.debug(chalk.dim('>> PING'))
      if (pingState >= 1) {
        logger.error('missed PING')
        clearInterval(pingInterval)
        setTimeout(() => {
          logger.debug('reconnecting to websocket')
          wsConnect()
        }, 1000)
      } else {
        pingState += 1
        ws.ping(() => {})
      }
    }

    const wsOnOpen = async () => {
      logger.success('connected to websocket')
      pingInterval = setInterval(pingServer, PING_INTERVAL)
    }

    const wsOnClose = async () => {
      logger.debug('disconnected from websocket')
      clearInterval(pingInterval)
      setTimeout(() => {
        logger.debug('reconnecting to websocket')
        wsConnect()
      }, 1000)
    }

    const wsOnPong = async () => {
      logger.debug(chalk.dim('<< PONG'))
      pingState = 0
    }

    const wsOnMessage = async (e) => {
      clearInterval(pingInterval)
      pingInterval = setInterval(pingServer, PING_INTERVAL)
      try {
        const parsedMessage = JSON.parse(e.data)
        const { sourceConnectionId, data, action } = parsedMessage

        if (action && action === 'FORCE_CLIENT_DISCONNECT') {
          logger.error(
            'websocket was forcefully disconnected by another client for the same host',
          )
          process.exit(1)
        }

        const {
          req,
          reqId,
          bodyChunk,
          bodyChunkIndex,
          endBodyChunk,
          totalChunks,
        } = data || {}

        if (reqId) {
          const reqLogger = logger.withTag(reqId)
          const reqStartTime = new Date()
          reqLogger.log(
            chalk.dim('>>'),
            chalk.bold.inverse(req.method),
            chalk.bold.underline(`${host}${req.originalUrl}`),
            chalk.dim(req.sourceIp),
            chalk.dim(sourceConnectionId),
          )

          if (!reqBodyChunks[reqId]) {
            reqBodyChunks[reqId] = []
          }

          if (bodyChunk) {
            reqLogger.debug(`received bodyChunk[${bodyChunkIndex}]`, bodyChunk)
            reqBodyChunks[reqId].push({
              bodyChunkIndex,
              chunk: Buffer.from(bodyChunk, 'base64'),
            })

            if (
              reqBodyEndRes[reqId] &&
              reqBodyChunks[reqId].length === reqBodyEndRes[reqId].totalChunks
            ) {
              reqLogger.debug(
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
              reqLogger.debug(
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

          const baseUrl = `${scheme}://${localhost}:${localPort}${reqOriginalUrl}`

          reqLogger.debug('proxying request to', baseUrl)

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
          //     logger.log('HEAD', headRes.status, headRes.headers)
          //   } catch (e) {
          //     logger.debug('Could not HEAD')
          //   }
          // }
          //
          // if (headRes?.status === 304) {
          //   logger.log('sending 304 response from HEAD', reqId)
          //   return sendWsResponse(ws, sourceConnectionId, reqId, headRes)
          // }

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
            reqLogger.error(
              chalk.red('ERROR fetching request for', baseUrl, e.code),
            )
            return sendWsResponse(ws, sourceConnectionId, reqId, {
              status: 503,
              headers: {},
            })
          }

          reqLogger.debug('response received status', res.status)

          if (res.status === 304) {
            reqLogger.success(
              chalk`{green << 304} {dim ${formatDuration(reqStartTime)}}`,
            )
            sendWsResponse(ws, sourceConnectionId, reqId, res)
          } else {
            reqLogger.debug(
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
            const isCacheControlPrivate = (
              res.headers['cache-control'] || ''
            ).match(/private|no-store/i)
            const shouldStreamBody =
              (contentType &&
                contentType.match(/(^text\/html)|(^application\/json)/i) &&
                (!contentLength || contentLength < MAX_WS_STREAMABLE_LENGTH)) ||
              (contentLength && contentLength < MAX_WS_STREAMABLE_LENGTH) ||
              isCacheControlPrivate

            reqLogger.debug(
              `shouldStreamBody=${shouldStreamBody} ContentLength=${contentLength} ContentType=${contentType}`,
            )

            let bodyBuf = null
            let responseBodySentOverWS = false
            let streamBodyToWsErr = null

            if (
              contentLength &&
              contentLength < MAX_SINGLE_FRAME_CONTENT_LENGTH
            ) {
              // If content-length is supplied and it is less than a WS single
              // frame, send as such
              reqLogger.debug('sending single frame response over websocket')
              bodyBuf = await streamToBase64(res.data)
              sendWsResponse(ws, sourceConnectionId, reqId, res, bodyBuf)
              responseBodySentOverWS = true
              reqLogger.success(
                chalk`{green << ${res.status}} {dim ${formatDuration(
                  reqStartTime,
                )}, ${prettyBytes(bodyBuf.length)}, body fit in single-frame}`,
              )
            } else if (shouldStreamBody) {
              // If the content-type is a common low-filesize/high-use content-type (HTML or JSON from a webserver)
              // and either the content-type is unknown or is low enough to
              // stream reasonably
              reqLogger.debug('sending streamed response over websocket')
              ;[streamBodyToWsErr, bodyBuf] = await streamBodyToWs(
                reqLogger,
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
                maxWsSize,
              )
              if (streamBodyToWsErr) {
                reqLogger.debug(
                  'could not stream body over WS, falling back to S3 proxy',
                  streamBodyToWsErr,
                )
              } else {
                responseBodySentOverWS = true
                reqLogger.success(
                  chalk`{green << ${res.status}} {dim ${formatDuration(
                    reqStartTime,
                  )}, ${prettyBytes(bodyBuf.length)}, body chunked}`,
                )
              }
            }

            if (!responseBodySentOverWS) {
              // Otherwise stream the response to S3 unless it is cachable
              // (etag present, no authorization header, no cookie, no
              // cache-control 0) and already present in S3 (expires daily)
              reqLogger.debug('sending response over s3')

              const cacheEligible = (res.headers['cache-control'] || '').match(
                /public|no-cache/i,
              )
              const cacheKey =
                (res.headers['etag'] || '').length > 0
                  ? crypto
                      .createHash('sha256')
                      .update(`${baseUrl}$$${res.headers['etag']}`)
                      .digest('hex')
                  : reqId
              const cacheS3Key = `responses/${cacheKey}`

              let cacheKeyExists = false
              let existingCachedResponse = null
              if (cacheEligible) {
                try {
                  existingCachedResponse = await s3Client
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
                reqLogger.debug('serving previously cached key', cacheS3Key)
                sendWsResponse(
                  ws,
                  sourceConnectionId,
                  reqId,
                  res,
                  null,
                  cacheS3Key,
                )
                reqLogger.success(
                  chalk`{green << ${res.status}} {dim ${formatDuration(
                    reqStartTime,
                  )}, ${
                    existingCachedResponse?.ContentLength &&
                    prettyBytes(existingCachedResponse.ContentLength)
                  }, body via s3 cache}`,
                )
              } else {
                const { passThrough, promise } = uploadFromStream(
                  s3Client,
                  res,
                  cacheS3Key,
                  bucket,
                )
                const startUploadTime = new Date()
                reqLogger.debug('uploading response to s3 for serving')

                let bodyStream = null
                if (streamBodyToWsErr) {
                  // Send from previously read body buffer that exceeded max
                  // size
                  bodyStream = Readable.from(bodyBuf)
                } else {
                  // Send directly from response stream
                  bodyStream = res.data
                }

                bodyStream.pipe(passThrough)
                let bodyLength = 0
                bodyStream.on('data', (chunk) => {
                  bodyLength += chunk.length
                })

                return promise
                  .then((result) => {
                    reqLogger.debug('sending s3 response key')
                    sendWsResponse(
                      ws,
                      sourceConnectionId,
                      reqId,
                      res,
                      null,
                      result.Key,
                    )
                    reqLogger.success(
                      chalk`{green << ${res.status}} {dim ${formatDuration(
                        reqStartTime,
                      )}, ${
                        bodyLength && prettyBytes(bodyLength)
                      }, body via s3}`,
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
        logger.error(e)
      }
    }

    const wsConnect = () => {
      if (ws) {
        ws.terminate()
        ws.removeEventListener('open', wsOnOpen)
        ws.removeEventListener('close', wsOnClose)
        ws.removeEventListener('message', wsOnMessage)
        ws.removeEventListener('pong', wsOnPong)
      }

      signedWsEndpoint = generateSignedWsEndoint()
      logger.debug('signedWsEndpoint', signedWsEndpoint)

      ws = new WebSocket(signedWsEndpoint)
      ws.addEventListener('open', wsOnOpen)
      ws.addEventListener('close', wsOnClose)
      ws.addEventListener('message', wsOnMessage)
      ws.addEventListener('pong', wsOnPong)
      return ws
    }

    wsConnect()
  })
}

const listConnections = async (endpoint, { debug }) => {
  const logger = consola.create({
    level: debug ? 4 : 3,
    defaults: {
      additionalColor: 'white',
    },
  })

  const { table, region } = await fetchWormholeConfig(logger, endpoint)

  logger.log('listing connections from', chalk.underline(table))

  const documentClient = new AWS.DynamoDB.DocumentClient({
    region,
  })

  try {
    logger.log(
      await documentClient
        .scan({
          TableName: table,
        })
        .promise(),
    )
  } catch (e) {
    logger.error(
      'Could not connect to DynamoDB. Make sure AWS credentials are available via AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION or AWS_PROFILE.',
    )
    throw e
  }
}

module.exports = {
  wsListen,
  listConnections,
}
