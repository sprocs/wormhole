const aws4 = require('aws4')
const awscred = require('awscred')
const { program } = require('commander')
const WebSocket = require('ws')
const https = require('https')
const queryString = require('query-string')
const axios = require('axios')
const AWS = require('aws-sdk')
const { Stream, PassThrough } = require('stream')

// const WsStream = require('wstunnel/lib/WsStream')
// const ClientConn = require('wstunnel/lib/httptunnel/ClientConn')
// const bindStream = require('wstunnel/lib/bindStream')

// https://kkf5qj7nzf.execute-api.us-east-2.amazonaws.com/wormholeConfig

// console.log(WsStream)
// const httpConn = new ClientConn('http://localhost:3000')
// console.log(httpConn)
// httpConn.connect({}, (err) => {
//   console.log(err)
// })

const parsePort = (value, dummyPrevious) => {
  const parsedValue = parseInt(value, 10)
  if (isNaN(parsedValue)) {
    throw new commander.InvalidArgumentError('Not a number.')
  }
  return parsedValue
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

const sendWsResponse = (ws, sourceConnectionId, reqId, res, s3Key = null) => {
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
    .requiredOption(
      '-p, --port <port>',
      'local port to proxy requests against',
      parsePort,
    )
    .requiredOption('-e, --endpoint <https endpoint>', 'API Gateway endpoint')
    .version('0.0.1')

  await program.parseAsync(process.argv)

  const { endpoint, port, localhost } = program.opts()

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
      const ws = new WebSocket(signedWsEndpoint)

      ws.on('open', () => {
        console.log('Connected to websocket')
      })
      ws.on('close', () => {
        console.log('Disconnected from websocket')
      })
      ws.on('message', async (message) => {
        try {
          const parsedMessage = JSON.parse(message)
          console.log(new Date(), 'Received message from websocket', parsedMessage)
          const { sourceConnectionId, data } = parsedMessage

          // console.log(data)
          if (data.req) {
            const {
              reqId,
              req: {
                sourceIp,
                headers,
                originalUrl, //: '/application.css?stuff=1',
                method,
                body,
                // bodyS3Key,
              },
            } = data

            // const baseUrl = `http://${localhost}:${port}`
            const baseUrl = `http://${localhost}:${port}${originalUrl}`
            console.log(new Date(), 'Proxying request to', baseUrl, originalUrl)

            const res = await axios({
              method,
              url: baseUrl,
              timeout: 10000,
              headers,
              responseType: 'stream',
              decompress: false,
              validateStatus: function (status) {
                return (status >= 200 && status < 300) || status === 304
              },
              // data
            })

            console.log(new Date(), 'response received', baseUrl, res.status, reqId);

            if (res.status === 304) {
              console.log('sending 304 response', reqId);
              sendWsResponse(ws, sourceConnectionId, reqId, res)
            } else {
              console.log('HERE', res.headers['content-length']);
              // console.log(res.status, res.headers, res.data);
              // const response = await downloadFile(event.fileUrl);
              const { passThrough, promise } = uploadFromStream(
                s3Client,
                res,
                `responses/${reqId}`,
                bucket,
              )

              const startUploadTime = new Date()
              console.log(new Date(), 'uploading response', reqId, startUploadTime);

              res.data.pipe(passThrough)

              return promise
                .then((result) => {
                  console.log(new Date(), 'done, sending response for', reqId, (new Date() - startUploadTime)/1000);
                  sendWsResponse(ws, sourceConnectionId, reqId, res, result.Key)
                })
                .catch((e) => {
                  throw e
                })

              // return event.fileName;
              // const downloadFile = async (downloadUrl: string): Promise<any> => {
              //   return axios.get(downloadUrl, {
              //     responseType: 'stream',
              //   });
              // };
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
