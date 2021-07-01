/*
Copyright 2017 - 2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance with the License. A copy of the License is located at
    http://aws.amazon.com/apache2.0/
or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and limitations under the License.
*/

const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const compression = require('compression')
const { getCurrentInvoke } = require('@vendia/serverless-express')
const morgan = require('morgan')

const app = express()

app.use(compression())
app.use(cors())
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(morgan('tiny'))

const wormholeProxy = express.Router()

wormholeProxy.get('/', (req, res) => {
  console.log(req)

  res.format({
    'text/plain': function () {
      res.send('ok')
    },

    'text/html': function () {
      res.send(
        '<html><head><title>wormhole</title></head><body><h1>Wormhole</h1></body></html>',
      )
    },

    'application/json': function () {
      res.send({ status: 'ok' })
    },

    default: function () {
      res.status(406).send('Not Acceptable')
    },
  })
})

wormholeProxy.use((err, req, res, next) => {
  console.error(err)
  next()
})

app.use('/', wormholeProxy)

module.exports = app
