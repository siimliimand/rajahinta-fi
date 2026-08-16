/**
 * Ranking Module.
 *
 * Registers the RankingService for injection into composition roots
 * and downstream consumers (API layer, comparison views).
 *
 * @module RankingModule
 */
import { Module } from '@nestjs/common';
import { RankingService } from './ranking.service';

@Module({
  providers: [RankingService],
  exports: [RankingService],
})
export class RankingModule {}