import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Rajahinta.fi API')
    .setDescription('Finnish cross-border beverage landed-cost intelligence API')
    .setVersion('0.1.0')
    .addTag('calculations', 'Landed-cost calculation endpoints')
    .addTag('products', 'Product and price data endpoints')
    .addTag('health', 'Service health checks')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3001',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Rajahinta backend listening on http://localhost:${port}`);
}

bootstrap();