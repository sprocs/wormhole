const aws4 = require('aws4')
const awscred = require('awscred')
const commander = require('commander')
const WebSocket = require('ws')
const https = require('https')
const queryString = require('query-string');

const AWS_REGION = 'us-east-2'
const SOCKET_HOST = '5ds6ld8xpf'
const ENV = 'cdunn'
const WEBSOCKET_URL = `${SOCKET_HOST}.execute-api.${AWS_REGION}.amazonaws.com`

awscred.load(function (err, data) {
  if (err) throw err
  console.log(data.credentials.sessionToken)

  var queryStringStr = queryString.stringify({
    'X-Amz-Security-Token': data.credentials.sessionToken,
    clientType: 'CLIENT',
  })
  console.log(queryStringStr)

  const { path } = aws4.sign(
    {
      host: WEBSOCKET_URL,
      path: `/${ENV}?` + queryStringStr,
      service: `execute-api`,
      region: AWS_REGION,
      signQuery: true,
    },
    data.credentials,
  )

  const postData = new TextEncoder().encode(
    JSON.stringify({
      action: 'wormholeResponse',
      todo: 'Buy the milk',
    }),
  )

  console.log(WEBSOCKET_URL)

  // function request(opts) { https.request(opts, function(res) { res.pipe(process.stdout) }).end(opts.body || '') }
  // const aws4Request = aws4.sign(
  //   {
  //     host: WEBSOCKET_URL,
  //     path:
  //     `/${ENV}/@connections/BypJOfoNCYcCHOg=` +
  //     (data.credentials.sessionToken
  //       ? `?X-Amz-Security-Token=${encodeURIComponent(
  //         data.credentials.sessionToken,
  //       )}`
  //       : ''),
  //     service: `execute-api`,
  //     region: AWS_REGION,
  //     signQuery: true,
  //     body: JSON.stringify({
  //       action: "wormholeResponse",
  //       todo: 'Buy the milk'
  //     })
  //   },
  //   data.credentials,
  // )
  // console.log(request(aws4Request))
  const wsEndpoint = `wss://${WEBSOCKET_URL}${path}`
  console.log('Connecting to', wsEndpoint)

  const ws = new WebSocket(wsEndpoint)

  ws.on('open', function open() {
    console.log('websocket open')
    ws.send(JSON.stringify({ action: 'sendmessage', data: { hi: 'ho' } }))
  })

  ws.on('close', function close() {
    console.log('disconnected')
  })

  ws.on('message', function incoming(data) {
    console.log(data)
  })

  const duplex = WebSocket.createWebSocketStream(ws, { encoding: 'utf8' })
  duplex.pipe(process.stdout)
  process.stdin.pipe(duplex)
})
