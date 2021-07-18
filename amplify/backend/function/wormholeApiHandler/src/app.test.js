const request = require('supertest')
const express = require('express')
const { documentClient } = require('./wormholeData')
const wormholeWs = require('./wormholeWs')

const app = require('./app')

beforeAll(() => {
  process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME = 'WormholeConnections-test'
  process.env.WORMHOLE_WS_ENDPOINT = 'ws://websocketendpoint.com'
})

test('no client connections', (done) => {
  request(app)
    .get('/test')
    .expect(412)
    .end(function (err, res) {
      if (err) throw err
      done()
    })
})

jest.mock('./wormholeWs')

test('route to connection', async () => {
  await documentClient
    .put({
      TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
      Item: {
        connectionId: 'CLIENT_CONNECTION_ID',
        isClient: true,
        clientForHost: 'host.com',
      },
    })
    .promise()

  await documentClient
    .put({
      TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
      Item: {
        connectionId: 'CLIENT2_CONNECTION_ID',
        isClient: true,
        clientForHost: 'nothost.com',
      },
    })
    .promise()

  const ws = jest.fn()
  ws.addEventListener = jest.fn()
  ws.removeEventListener = jest.fn()
  ws.addEventListener.mockImplementation((action, onMessage) => {
    onMessage({
      data: JSON.stringify({
        data: {
          reqId: 'BADREQUESTID',
          res: {
            status: 200,
            headers: {
              'content-type': 'text/plain',
            },
            body: Buffer.from('blah').toString('base64'),
          },
        },
      }),
    })
    onMessage({
      data: JSON.stringify({
        data: {
          reqId: 'REQUESTID',
          res: {
            status: 200,
            headers: {
              'content-type': 'text/plain',
            },
            body: Buffer.from('test').toString('base64'),
          },
        },
      }),
    })
  })
  ws.send = jest.fn()
  wormholeWs.initWs.mockImplementation((cb) => {
    return cb(null, ws)
  })

  const res = await request(app)
    .get('/test')
    .set('Host', 'host.com')
    .set('x-amzn-trace-id', 'REQUESTID')
    .expect(200)

  expect(ws.send).toHaveBeenCalledWith(
    '{"action":"sendmessage","connectionId":"CLIENT_CONNECTION_ID","data":{"reqId":"REQUESTID","req":{"sourceIp":"::ffff:127.0.0.1","headers":{"host":"host.com","accept-encoding":"gzip, deflate","x-amzn-trace-id":"REQUESTID","connection":"close"},"originalUrl":"/test","method":"GET"}}}',
  )
  expect(ws.removeEventListener).toHaveBeenCalled()
})

test('chunked body', async () => {
  await documentClient
    .put({
      TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
      Item: {
        connectionId: 'CLIENT_CONNECTION_ID',
        isClient: true,
        clientForHost: 'host.com',
      },
    })
    .promise()

  const ws = jest.fn()
  ws.addEventListener = jest.fn()
  ws.removeEventListener = jest.fn()
  ws.addEventListener.mockImplementation((action, onMessage) => {
    onMessage({
      data: JSON.stringify({
        data: {
          reqId: 'REQUESTID',
          bodyChunk: Buffer.from('test').toString('base64'),
          bodyChunkIndex: 0,
        },
      }),
    })
    onMessage({
      data: JSON.stringify({
        data: {
          reqId: 'REQUESTID',
          totalChunks: 1,
          endBodyChunk: true,
          res: {
            status: 200,
            headers: {
              'content-type': 'text/plain',
            },
          },
        },
      }),
    })
  })
  ws.send = jest.fn()
  wormholeWs.initWs.mockImplementation((cb) => {
    return cb(null, ws)
  })

  const res = await request(app)
    .get('/test')
    .set('Host', 'host.com')
    .set('x-amzn-trace-id', 'REQUESTID')
    .expect(200)

  expect(res.text).toEqual('test')
  expect(ws.send).toHaveBeenCalled()
  expect(ws.removeEventListener).toHaveBeenCalled()
})

test('/wormholeConfig', (done) => {
  request(app)
    .get('/wormholeConfig')
    .expect(200)
    .end(function (err, res) {
      if (err) throw err
      expect(res.body).toEqual(
        expect.objectContaining({
          wsEndpoint: 'ws://websocketendpoint.com',
          table: 'WormholeConnections-test',
        }),
      )
      expect(res.body.host).toMatch('127.0.0.1')
      done()
    })
})
