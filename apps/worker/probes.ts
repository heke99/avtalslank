import { PDFDocument } from 'pdf-lib';
import { scannerHealthReady } from './runtime.ts';
import { ClamAvInstreamClient, QpdfInspector } from '../../packages/document-processing/src/production.ts';
export class ScannerProbe {
    private version = '';
    private checkedAt = 0;
    constructor(private scanner: Pick<ClamAvInstreamClient, 'health' | 'scan'>) { }
    async check(now = Date.now()) {
        const h = await this.scanner.health();
        if (!scannerHealthReady(h, now))
            return false;
        if (this.version === h.version && now - this.checkedAt < 3600000)
            return true;
        const clean = new TextEncoder().encode('Avtalslank scanner self check');
        // Standard harmless EICAR antivirus test, generated in memory and never persisted.
        const eicar = new TextEncoder().encode(['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
        const [a, b] = await Promise.all([this.scanner.scan(clean), this.scanner.scan(eicar)]);
        if (a.result !== 'CLEAN' || b.result !== 'INFECTED')
            return false;
        this.version = h.version;
        this.checkedAt = now;
        return true;
    }
}
export class PdfProbe {
    private version = '';
    constructor(private pdf: QpdfInspector) { }
    async check() { const h = await this.pdf.health(); if (this.version === h.version)
        return true; const doc = await PDFDocument.create(); doc.addPage([100, 100]); const bytes = await doc.save(); const report = await this.pdf.inspect(bytes, { maximumBytes: 10485760, maximumPages: 100 }); if (!report.passed || report.encrypted || report.pageCount !== 1)
        return false; this.version = h.version; return true; }
}
