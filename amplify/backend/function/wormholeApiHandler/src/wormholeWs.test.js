const fns = require('./wormholeWs')
const WebSocket = require('ws')
const aws4 = require('aws4')
const awscred = require('awscred')
const wormholeConstants = require('./wormholeConstants')
// jest.mock('./wormholeConstants')

// const { documentClient } = require('./wormholeData')

beforeAll(() => {
  process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME = 'WormholeConnections-test'
  process.env.WORMHOLE_WS_ENDPOINT = "https://wormhole-endpoint.com"
})

jest.mock('aws-sdk', () => {
  return {
    ...jest.requireActual('aws-sdk'),
    ApiGatewayManagementApi: jest.fn(),
  }
})
const { ApiGatewayManagementApi } = require('aws-sdk')

jest.mock('ws')
jest.mock('awscred')
jest.mock('aws4')
jest.mock('./wormholeCache')

beforeEach(() => {
  awscred.load.mockImplementation((cb) => {
    cb(null, {
      credentials: {}
    })
  })
  aws4.sign.mockReturnValue({ path: "/signedPath?signature=v3" })
})

test('initWs open', (done) => {
  let wsOnMock = jest.fn()
  wsOnMock.mockImplementationOnce((event, cb) => {
    expect(event).toBe("open")
    cb()
  })
  wsOnMock.mockImplementationOnce((event, cb) => {
    expect(event).toBe("message")
  })
  wsOnMock.mockImplementationOnce((event, cb) => {
    expect(event).toBe("close")
  })
  WebSocket.mockImplementation(() => { return {
    on: wsOnMock,
  } })
  fns.initWs(
    (err) => {
      expect(err).toBe(null)
      done()
    },
  )
})

const { wormholeCache } = require('./wormholeCache')

test('initWs message CLIENT_DISCONNECT', (done) => {
  wormholeCache.keys.mockReturnValue(['CLIENT_CONNECTION_ID'])
  wormholeCache.get.mockReturnValue({ connectionId: 'CLIENT_CONNECTION_ID' })
  wormholeCache.del.mockImplementation((k) => {
    expect(k).toBe('CLIENT_CONNECTION_ID')
  })
  let wsOnMock = jest.fn()
  wsOnMock.mockImplementationOnce((event, cb) => {
    expect(event).toBe("open")
  })
  wsOnMock.mockImplementationOnce((event, cb) => {
    expect(event).toBe("message")
    cb(JSON.stringify({
      action: "CLIENT_DISCONNECT",
      sourceConnectionId: "CLIENT_CONNECTION_ID",
    }))
    expect(wormholeCache.del).toHaveBeenCalled()
    done()
  })
  wsOnMock.mockImplementationOnce((event, cb) => {
    expect(event).toBe("close")
  })
  WebSocket.mockImplementation(() => { return {
    on: wsOnMock,
  } })
  fns.initWs(
    (err) => {
      expect(err).toBe(null)
    },
  )
})

test('chunkBodyToWs single frame', () => {
  let ws = {
    send: jest.fn().mockImplementation((message) => {
      expect(message).toEqual(JSON.stringify({"action":"sendmessage","connectionId":"CONNECTION_ID","data":{"reqId":"REQUEST_ID","endBodyChunk":true,"totalChunks":1,"bodyChunkIndex":0,"bodyChunk":"Qk9EWQ==","headers":{"content-type":"application/json"}}}))
    })
  }
  fns.chunkBodyToWs(
    ws,
    "CONNECTION_ID",
    "REQUEST_ID",
    {
      headers: {
        'content-type': 'application/json'
      },
    },
    "BODY"
  )
})

jest.mock('./wormholeConstants', () => {
  const originalModule = jest.requireActual('./wormholeConstants')
  return {
    __esModule: true,
    ...originalModule,
    MAX_SINGLE_FRAME_CONTENT_LENGTH: 10
  }
})

describe('multi frame', () => {
  test('chunkBodyToWs multi frame', () => {
    let ws = {
      send: jest.fn().mockImplementationOnce((message) => {
        expect(message).toEqual(JSON.stringify({"action":"sendmessage","connectionId":"CONNECTION_ID","data":{"reqId":"REQUEST_ID","bodyChunkIndex":0,"bodyChunk":"Qk9EWSBDT05URQ=="}}))
      }).mockImplementationOnce((message) => {
        expect(message).toEqual(JSON.stringify({"action":"sendmessage","connectionId":"CONNECTION_ID","data":{"reqId":"REQUEST_ID","bodyChunkIndex":1,"bodyChunk":"TlQ="}}))
      }).mockImplementationOnce((message) => {
        expect(message).toEqual(JSON.stringify({"action":"sendmessage","connectionId":"CONNECTION_ID","data":{"reqId":"REQUEST_ID","endBodyChunk":true,"totalChunks":2,"headers":{"content-type":"application/json"}}}))
      })
    }
    fns.chunkBodyToWs(
      ws,
      "CONNECTION_ID",
      "REQUEST_ID",
      {
        headers: {
          'content-type': 'application/json'
        },
      },
      "BODY CONTENT"
    )
  })
})
