#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { HelloEcsCdkStack } from '../lib/hello-ecs-cdk-stack';

const app = new cdk.App();
new HelloEcsCdkStack(app, 'HelloEcsCdkStack', {
  env: { account: '505728816578', region: 'us-east-1' },
});
