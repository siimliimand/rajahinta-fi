/**
 * RankingModule — registration and dependency wiring for the ranking API.
 *
 * Registers {@link RankingController} which depends on {@link RankingService}
 * provided by `@rajahinta/core-domain`'s `RankingModule`.
 *
 * @module RankingModule
 */

import { Module } from '@nestjs/common';
import { RankingController } from './ranking.controller';

@Module({
  controllers: [RankingController],
})
export class RankingModule {}