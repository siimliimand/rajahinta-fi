"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoreDomainModule = exports.TaxCalculationEngine = exports.DISCLAIMER_EN = exports.DISCLAIMER_FI = void 0;
const common_1 = require("@nestjs/common");
exports.DISCLAIMER_FI = {
    text: 'Arvioitu kokonaiskustannus Suomessa, ei lopullinen verovelvollisuuden määrä.',
    language: 'fi',
};
exports.DISCLAIMER_EN = {
    text: 'Estimated total cost in Finland, not final legal tax liability.',
    language: 'en',
};
// ---------------------------------------------------------------------------
// Engine interface — pure function contract, no framework dependency
// ---------------------------------------------------------------------------
class TaxCalculationEngine {
}
exports.TaxCalculationEngine = TaxCalculationEngine;
// ---------------------------------------------------------------------------
// NestJS module — registration shell; domain logic is injected via providers
// ---------------------------------------------------------------------------
let CoreDomainModule = class CoreDomainModule {
};
exports.CoreDomainModule = CoreDomainModule;
exports.CoreDomainModule = CoreDomainModule = __decorate([
    (0, common_1.Module)({
        exports: [TaxCalculationEngine],
    })
], CoreDomainModule);
//# sourceMappingURL=index.js.map