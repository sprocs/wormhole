<p align="center"><strong>NOTE: THIS PROJECT IS A WORK-IN-PROGRESS, USE AT YOUR OWN DISCRETION</strong></p>

<p align="center">
  <img width="100%" src="assets/wormhole.png" />
</p>

[sprocs](https://sprocs.com) wormhole is a **serverless local tunnel** that uses API Gateway (HTTP and WebSocket), Lambda, DynamoDB, and S3 to
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

You can setup as many subdomains as you'd like using your own domain. Each
hostname can only be served by a single client so multiple hostnames via
subdomain is the easiest way to have multiple clients/users have their own local
tunnel.

You can setup subdomains by:
1. Navigate in AWS console to `API Gateway -> Custom domain names`
2. Click `Create`
3. Type the name of the subdomain/domain you'd like to create, example:
   `wormhole-1.mydomainhere.com`.
4. Create the `Custom domain name` with default settings but select your ACM
   certificate (wildcard `*.mydomainhere.com` or subdomain only `wormhole-1.mydomainhere.com` depending on your setup). If you do not have an ACM certificate, you can `Request a certificate` under the AWS `Certificate Manager` service. After validating your domain, a new certificate will be issued allowing you to serve SSL traffic over your subdomain.
5. After creating the `Custom domain name`, select it and then select the tab
   `API mappings` and then click `Configure API mappings`
6. Select the `wormholeApi-${env}` API gateway and leave the default settings
   (Stage: `$default`, Path: *empty*)
7. Select `Save`
8. Select the tab `Configuration` and copy the `API Gateway domain name` (ex: `xyz123.execute-api.us-east-2.amazonaws.com`) and add this as a `CNAME` for the subdomain specified in your DNS settings for your domain (example: add a CNAME for `wormhole-1.mydomainhere.com` to `xyz123.execute-api.us-east-2.amazonaws.com` in Route53 or wherever you manage the DNS for your domain)
9. After DNS propagation, you should now be able to use the subdomain to connect
   to your wormhole in place of your underlying API gateway endpoint.
10. Repeat this process for as many subdomains as you would like.

## Architecture

<p align="center">
  <img width="100%" src="assets/wormhole-architecture.png" />
</p>

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

Wormhole usage will generate an AWS bill that is your responsibility (likely negligible for normal use but do your own diligence). Wormhole utilizes [API Gateway (HTTP and WebSockets)](https://aws.amazon.com/api-gateway/pricing/), [DynamoDB On-Demand](https://aws.amazon.com/dynamodb/pricing/on-demand/), [S3](https://aws.amazon.com/s3/pricing), [Lambda](https://aws.amazon.com/lambda/pricing), and [Amplify](https://aws.amazon.com/amplify/pricing). See AWS pricing for more information.

Wormhole sets up the following AWS tags on resources it creates `sprocs_app = wormhole` and `sprocs_env = AMPLIFY_ENV_HERE` for billing reporting purposes.

Setup `AWS Budget` notifications to monitor for unexpected serverless costs.

By using only serverless AWS resources, you only pay for what you use and not for
idle time. Comparable SaaS offerings are almost always magnitudes more
costly.

## AWS Budget setup

To setup a simple cost budget monitor for your serverless components:

1. Navigate to `AWS Budgets` and select `Create budget`
2. Select `Cost budget` then `Next`
3. Set the desired budget amount to receive alerts and name your budget
4. If you are using a separate subaccount for your sprocs, you can just monitor
   the entire subaccount costs (as you cannot use billing tags on a subaccount).
   To monitor sprocs usage using billing tags, make sure you are on the "payer
   AWS account" (the root account) and make sure your sprocs tags are `active`
   by navigating to `Billing -> Cost allocation tags` and [activating](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/activating-tags.html)
   `sprocs_app` and `sprocs_env` tags if they are not already. This may take up
   to 24 hours for them to show in budget filtering options as per the [docs](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/activating-tags.html).
5. If you wish to budget just your sprocs usage with billing tags previously
   setup, add a Filter when creating your Budget and select `Tag` for dimension
   and filter by `sprocs_app` and/or `sprocs_env` as appropriate.

## Security

Sprocs creates AWS IAM roles/profiles during AWS Amplify deployment (via CloudFormation) with only necessary permissions to resources used (and often created) by the app and app environment (as an example, the wormhole lambda functions have access to the wormhole S3 bucket and DynamoDB tables/etc.). You can review these permissions in the CloudFormation templates.

For added security/visibility, we recommend [creating an AWS subaccount](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_accounts_create.html) via `AWS Organizations` to isolate your sprocs.

Potential security vulnerabilities can be reported directly to us at `security@sprocs.com`.

## About

Wormhole is developed and maintained by [sprocs](https://sprocs.com). sprocs develops both free and commercial serverless apps for AWS.

## License & Copyright

Server side code is licensed under [Server Side Public License (SSPL) 1.0](https://www.mongodb.com/licensing/server-side-public-license). Please see [LICENSE](https://github.com/sprocs/wormhole/blob/master/LICENSE.txt) for details.

Client side code is licensed under [Apache 2.0](https://opensource.org/licenses/Apache-2.0). Please see [LICENSE](https://github.com/sprocs/wormhole/blob/master/packages/wormhole/LICENSE.txt) for details.

Copyright (c) 2021 Kaytos, LLC dba sprocs
