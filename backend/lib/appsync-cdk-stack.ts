import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  AccountRecovery,
  CfnUserPoolGroup,
  UserPool,
  UserPoolClient,
  VerificationEmailStyle,
} from 'aws-cdk-lib/aws-cognito';
import {
  CfnOutput,
  Duration,
  Expiration,
  RemovalPolicy,
} from 'aws-cdk-lib'
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'node:path';
import {
  GraphqlApi,
  Definition,
  AuthorizationType,
  FieldLogLevel, MappingTemplate, PrimaryKey, Values,
} from 'aws-cdk-lib/aws-appsync';



export class AppsyncCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const { userPool, userPoolClient } = this.userPool();

    const todoTable = new Table(this, 'Todo Table', {
      removalPolicy: RemovalPolicy.DESTROY,
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'id', type: AttributeType.STRING },
    });

    const { api } = this.graphqlApi(userPool, todoTable);

    new CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
    });

    new CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
    });

    new CfnOutput(this, 'GraphQLAPIURL', {
      value: api.graphqlUrl,
    });

    new CfnOutput(this, 'GraphQLAPIKey', {
      value: api.apiKey as string,
    });

    new CfnOutput(this, 'GraphQLAPIID', {
      value: api.apiId,
    });
  }

  private userPool() {
    const userPool = new UserPool(this, 'TodoUserPool', {
      selfSignUpEnabled: true,
      accountRecovery: AccountRecovery.PHONE_AND_EMAIL,
      userVerification: {
        emailStyle: VerificationEmailStyle.CODE,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
    });

    new CfnUserPoolGroup(this, 'TodoUserPoolGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'Admin',
      description: 'Admin users for the TodoAPI',
    });

    const userPoolClient = new UserPoolClient(this, 'TodoUserPoolClient', {userPool});

    return {userPool, userPoolClient};
  }

  private graphqlApi(userPool: UserPool, todoTable: Table) {
    const api = new GraphqlApi(this, 'TodoApi', {
      name: 'TodoTestAPI',
      definition: Definition.fromFile(path.join(__dirname, 'schema.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool,
          },
        },
        additionalAuthorizationModes: [
          {
            authorizationType: AuthorizationType.API_KEY,
            apiKeyConfig: {
              name: 'simple api key',
              description: 'a simple api key',
              expires: Expiration.after(Duration.days(30)),
            },
          },
        ],
      },
      logConfig: {
        fieldLogLevel: FieldLogLevel.ALL,
      },
      xrayEnabled: true,
    })

    api
      .addDynamoDbDataSource('TodoTableQueryGetTodo', todoTable)
      .createResolver('GetTodoResolver', {
        typeName: 'Query',
        fieldName: 'getTodo',
        requestMappingTemplate: MappingTemplate.dynamoDbGetItem('id', 'id'),
        responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
      });

    api
      .addDynamoDbDataSource('TodoTableQueryScanTodos', todoTable)
      .createResolver('ListTodoResolver', {
        typeName: 'Query',
        fieldName: 'listTodos',
        requestMappingTemplate: MappingTemplate.dynamoDbScanTable(),
        responseMappingTemplate: MappingTemplate.dynamoDbResultList(),
      });

    api
      .addDynamoDbDataSource('TodoTableMutationAddTodo', todoTable)
      .createResolver('AddTodoResolver', {
        typeName: 'Mutation',
        fieldName: 'addTodo',
        requestMappingTemplate: MappingTemplate.dynamoDbPutItem(
          PrimaryKey.partition('id').auto(),
          Values.projecting('input'),
        ),
        responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
      });

    api
      .addDynamoDbDataSource('TodoTableMutationUpdateTodo', todoTable)
      .createResolver('UpdateTodoResolver', {
        typeName: 'Mutation',
        fieldName: 'updateTodo',
        requestMappingTemplate: MappingTemplate.dynamoDbPutItem(
          PrimaryKey.partition('id').is('input.id'),
          Values.projecting('input'),
        ),
        responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
      });

    api
      .addDynamoDbDataSource('TodoTableMutationDeleteTodo', todoTable)
      .createResolver('DeleteTodoResolver', {
        typeName: 'Mutation',
        fieldName: 'deleteTodo',
        requestMappingTemplate: MappingTemplate.dynamoDbDeleteItem('id', 'id'),
        responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
      });

    return { api };
  }
}
