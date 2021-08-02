<p><center>**NOTE: THIS PROJECT IS A WORK-IN-PROGRESS, USE AT YOUR OWN DISCRETION**</center></p>

<p align="center">
  <img width="100%" src="https://sprocs-assets.s3.us-east-2.amazonaws.com/wormhole.png" />
</p>

wormhole is a **serverless local tunnel** that uses API Gateway (HTTP and WebSocket), Lambda, DynamoDB, and S3 to
proxy web requests such as webhooks or API requests to your local environment for testing/development purposes.

- **Easy-to-deploy**: click-through deployment wizard via AWS Amplify
- **Gain visibility and control over your local proxy traffic**: keep your development requests within your own cloud infrastructure, know who has access
- **Multiple hosts/clients**: setup unlimited custom subdomains for multiple clients (or use single API Gateway endpoint)
- **HTTP auth support**: setup HTTP auth to protect your public endpoint

Some use cases:
- Developing mobile apps with local APIs
- Developing with webhooks from third party services (Twilio, GitHub, etc.)
- Client demos

## Getting Started

[![amplifybutton](https://oneclick.amplifyapp.com/button.svg)](https://console.aws.amazon.com/amplify/home#/deploy?repo=https://github.com/sprocs/wormhole)

After deployment, run the client locally with your newly setup HTTP API Gateway
endpoint (or custom subdomain) as the first argument and local http port to proxy to as the second argument:

```
AWS_PROFILE=my-aws-profile npx @sprocs/wormhole listen https://my-api-gateway-id.execute-api.us-east-2.amazonaws.com 3000
```

## AWS profile/credentials for wormhole client

The wormhole client uses [aws-sdk](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/) and [awscred](https://github.com/mhart/awscred#awscredloadcredentialsandregionoptions-cb) to load your AWS credentials and sign requests (sigv4) to access your wormhole resources on AWS (WebSocket API, wormhole S3 bucket, etc).

The wormhole client AWS profile/credentials will need the IAM permissions as specified in
[amplify/backend/policies/wormholeClientPolicy/wormholeClientPolicy-cloudformation-template.json](https://github.com/sprocs/wormhole/blob/main/amplify/backend/policies/wormholeClientPolicy/wormholeClientPolicy-cloudformation-template.json)

A group with this IAM policy is created for each deployed environment as
`wormholeClientPolicy-${env}` in your IAM Groups. You can simply add or
create a user to the group to give it appropriate IAM permissions to act as a
wormhole client.

Once complete, you can specify the AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION
or AWS_PROFILE while running the wormhole client.

Standard environment variables or AWS profiles are the best way to provide
credentials to your client. AWS Credentials can be provided to the client in standard ways:

```
# via profiles:
AWS_PROFILE=my-aws-profile npx @sprocs/wormhole ...

# via keys:
AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=AKIA... AWS_SECRET_ACCESS_KEY=2Yd4z... npx @sprocs/wormhole ...

# or specified in your shell config .bashrc/.zshrc/etc...
```

## Custom subdomains

## Architecture

## Tips

* When running JS apps that serve assets via a build system (webpack based/Next.js/Create React
App/etc), running the compiled/built/optimized app is much more stable than
trying to serve the development build from localhost. The assets often have
`no-store` cache-control headers and the unoptimized large file sizes that can lead
to websocket rate limits trying to send megabytes of data over websockets (with a 32kb max frame size) instead of using S3 to proxy.
For example, running a `yarn build`/`yarn start` versus `yarn dev` for Next.js apps can often fix asset serving failures.

* Wormhole is designed for lightweight/basic web app usage such as dev API requests
for a mobile app or receiving webhooks from a third-party like Twilio.

## AWS pricing

Wormhole will likely generate a small AWS bill (negligible for normal use but do your own diligence). Wormhole utilizes [API Gateway (HTTP and WebSockets)](https://aws.amazon.com/api-gateway/pricing/), [DynamoDB On-Demand](https://aws.amazon.com/dynamodb/pricing/on-demand/), [S3](https://aws.amazon.com/s3/pricing), [Lambda](https://aws.amazon.com/lambda/pricing), and [Amplify](https://aws.amazon.com/amplify/pricing). See AWS pricing for more information.

Wormhole sets up the following AWS tags on resources it creates `sprocs_app = wormhole` and `sprocs_env = AMPLIFY_ENV_HERE` for billing reporting purposes.

Setup billing notifications to monitor for unexpected serverless costs.

## License

Server side code is licensed under the Server Side Public License ([SSPL](https://en.wikipedia.org/wiki/Server_Side_Public_License)). Please see [LICENSE](https://github.com/sprocs/wormhole/blob/master/LICENSE.txt) for details.

Client side code is licensed under [Apache 2.0](https://opensource.org/licenses/Apache-2.0). Please see [LICENSE](https://github.com/sprocs/wormhole/blob/master/packages/wormhole/LICENSE.txt) for details.
