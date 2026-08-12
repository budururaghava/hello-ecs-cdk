import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
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
        removalPolicy: cdk.RemovalPolicy.RETAIN,
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

    // Task Execution Role
    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'HelloEcsTaskDef', {
      family: 'hello-ecs-task',
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole,
    });

    // Container
    const container = taskDefinition.addContainer('hello-ecs-container', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      memoryLimitMiB: 512,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'hello-ecs' }),
    });

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
  }
}
