import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class HelloEcsCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import existing ECR repository or create new one
    let repository: ecr.IRepository;
    try {
      repository = ecr.Repository.fromRepositoryName(this, 'HelloEcsRepo', 'hello-ecs');
    } catch {
      repository = new ecr.Repository(this, 'HelloEcsRepo', {
        repositoryName: 'hello-ecs',
        
        lifecycleRules: [{ maxImageCount: 5 }],
      });
    }

    // VPC
    const vpc = new ec2.Vpc(this, 'HelloEcsVpc', {
      maxAzs: 2,
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'HelloEcsCluster', {
      clusterName: 'hello-ecs-cluster',
      vpc,
    });

    // DynamoDB Table
    //const table = dynamodb.Table.fromTableName(this, 'HelloEcsTable', 'hello-ecs-table');
    const table = new dynamodb.Table(this, 'HelloEcsTable', {  tableName: 'hello-ecs-table',  partitionKey: {    name: 'id',    type: dynamodb.AttributeType.STRING,  },  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,  removalPolicy: cdk.RemovalPolicy.RETAIN,});
    const dynamoConfigSecret = new secretsmanager.Secret(this, 'DynamoConfigSecret', { secretName: 'hello-ecs/dynamodb-config', secretObjectValue: { TABLE_NAME: cdk.SecretValue.unsafePlainText(table.tableName), AWS_REGION: cdk.SecretValue.unsafePlainText(this.region) } });

    // Task Execution Role
    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
      inlinePolicies: {
        SecretsManagerPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'secretsmanager:GetSecretValue',
                'kms:Decrypt',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });
    dynamoConfigSecret.grantRead(executionRole);

    // Task Role (for app to access DynamoDB)
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      inlinePolicies: {
        DynamoDBPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:PutItem',
                'dynamodb:GetItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
                'dynamodb:Scan',
              ],
              resources: [`arn:aws:dynamodb:us-east-1:505728816578:table/hello-ecs-table`],
            }),
          ],
        }),
      },
    });

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'HelloEcsTaskDef', {
      family: 'hello-ecs-task',
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole,
      taskRole,
    });

    // Container
    const container = taskDefinition.addContainer('hello-ecs-container', { image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'), memoryLimitMiB: 512, logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'hello-ecs' }), secrets: { TABLE_NAME: ecs.Secret.fromSecretsManager(dynamoConfigSecret, 'TABLE_NAME'), AWS_REGION: ecs.Secret.fromSecretsManager(dynamoConfigSecret, 'AWS_REGION') } });

    container.addPortMappings({ containerPort: 8080 });

    // Security Group for ECS Service
    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSG', {
      vpc,
      allowAllOutbound: true,
    });

    // ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, 'HelloEcsALB', {
      vpc,
      internetFacing: true,
    });

    const listener = alb.addListener('Listener', { port: 80 });

    // ECS Fargate Service
    const service = new ecs.FargateService(this, 'HelloEcsService', {
      serviceName: 'hello-ecs-service',
      cluster,
      taskDefinition,
      desiredCount: 1,
      securityGroups: [serviceSecurityGroup],
      assignPublicIp: false,
      healthCheckGracePeriod: cdk.Duration.seconds(120),
    });

    listener.addTargets('EcsTarget', {
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: { path: '/' },
    });

    // Allow ALB to reach ECS service
    serviceSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(alb.connections.securityGroups[0].securityGroupId),
      ec2.Port.tcp(8080)
    );

    // Outputs
    new cdk.CfnOutput(this, 'ALBUrl', {
      value: `http://${alb.loadBalancerDnsName}`,
      description: 'Application Load Balancer URL',
    });

    new cdk.CfnOutput(this, 'ECRRepository', {
      value: repository.repositoryUri,
      description: 'ECR Repository URI',
    });

    new cdk.CfnOutput(this, 'DynamoDBTable', {
      value: table.tableName,
      description: 'DynamoDB Table Name',
    });
  }
}
