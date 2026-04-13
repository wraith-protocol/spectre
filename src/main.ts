import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('WraithTEE');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  app.enableCors({
    origin: ['http://localhost:5173', 'https://wraith.vercel.app'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Wraith TEE API')
    .setDescription(
      'Phala TEE service for Wraith Protocol. Handles agent creation, ' +
        'stealth payments, Gemini AI chat, invoicing, scheduling, and privacy analysis. ' +
        'Private keys are derived inside TEE and never stored.',
    )
    .setVersion('0.1.0')
    .addTag('Health', 'TEE runtime status')
    .addTag('TEE', 'Attestation and TEE info')
    .addTag('Agent', 'Agent management and chat')
    .addTag('Notifications', 'Agent notification management')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`Wraith TEE Service running on port ${port}`);
  logger.log(`Swagger docs: http://localhost:${port}/docs`);
}

bootstrap();
