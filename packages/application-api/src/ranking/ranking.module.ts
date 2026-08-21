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
// Import the domain's RankingModule directly (not the whole CoreDomainModule)
// so a configured CoreDomainModule.forRoot(...) in the host app is not
// shadowed by a second, default (null-port) instance of the calculator.
import { RankingModule as DomainRankingModule } from '@rajahinta/core-domain';

@Module({
  imports: [DomainRankingModule],
  controllers: [RankingController],
})
export class RankingModule {}