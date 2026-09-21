-- La même facture arrive dans plusieurs boîtes Gmail (fournisseur en
-- copie, transfert entre associés). Chaque boîte donne un message et un
-- `gmail_attachment_id` différents : l'unicité (message_id,
-- gmail_attachment_id) ne voit rien, et le PDF est classé deux fois dans
-- Drive — parfois sous deux noms différents, le LLM ne renvoyant pas
-- toujours le même `prestation_type`.
--
-- Le hash du PDF est l'identité stable de la dépense : on l'ajoute pour
-- pouvoir refuser un classement dont le contenu est déjà dans Drive.

ALTER TABLE "invoice_filings" ADD COLUMN IF NOT EXISTS "pdf_sha256" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_filings_pdf_sha256_idx"
  ON "invoice_filings" ("pdf_sha256");
