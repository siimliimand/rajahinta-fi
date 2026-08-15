import { Module } from '@nestjs/common';
import { CoreDomainModule } from '@rajahinta/core-domain';
import { DataAcquisitionModule } from '@rajahinta/data-acquisition';
import { DataPlatformModule } from '@rajahinta/data-platform';
import { ApplicationApiModule } from '@rajahinta/application-api';

@Module({
  imports: [
    CoreDomainModule,
    DataAcquisitionModule,
    DataPlatformModule,
    ApplicationApiModule,
  ],
})
export class AppModule {}