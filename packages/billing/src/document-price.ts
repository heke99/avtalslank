export type DocumentTariff={documentOre:number;includedSigners:number;extraSignerOre:number};
export function quoteSignedDocuments(tariff:DocumentTariff,documents:number,signers:number){
 for(const v of [tariff.documentOre,tariff.includedSigners,tariff.extraSignerOre,documents,signers])if(!Number.isSafeInteger(v)||v<0)throw Error('INVALID_DOCUMENT_PRICE');
 if(documents<1||documents>200||signers<1||signers>50||tariff.includedSigners<1||tariff.includedSigners>50)throw Error('INVALID_DOCUMENT_PRICE');
 const extraSigners=Math.max(0,signers-tariff.includedSigners);const unitOre=tariff.documentOre+extraSigners*tariff.extraSignerOre;const totalOre=unitOre*documents;
 if(!Number.isSafeInteger(totalOre))throw Error('INVALID_DOCUMENT_PRICE');
 return {currency:'SEK' as const,documents,signers,extraSigners,unitOre,totalOre,tariff:{...tariff}};
}
