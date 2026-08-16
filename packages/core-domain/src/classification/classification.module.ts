/**
 * Classification Module.
 *
 * Aggregates the TransactionClassificationService and prepares for
 * versioned rule loading (task 6.3).
 *
 * Consumers import this module and get TransactionClassificationService
 * available for injection. The service uses TransportClassificationService
 * from the TransportEstimationModule internally.
 *
 * @module ClassificationModule
 */
import { Module } from '@nestjs/common';
import { TransportEstimationModule } from '../transport/transport-estimation.module';
import { TransactionClassificationService } from './transaction-classification.service';

@Module({
  imports: [TransportEstimationModule],
  providers: [TransactionClassificationService],
  exports: [TransactionClassificationService],
})
export class ClassificationModule {}