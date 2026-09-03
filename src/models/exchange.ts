export const ExchangeDirection = {
  INBOUND: "INBOUND",
  OUTBOUND: "OUTBOUND",
} as const;

export type ExchangeDirection =
  (typeof ExchangeDirection)[keyof typeof ExchangeDirection];

export const ExchangeStatus = {
  RECEIVED: "RECEIVED",
  VALIDATING: "VALIDATING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export type ExchangeStatus = (typeof ExchangeStatus)[keyof typeof ExchangeStatus];

export interface ExchangeValidationError {
  field: string;
  message: string;
}

export interface Exchange {
  id: string;
  tenantId: string;
  datasetId: string;
  direction: ExchangeDirection;
  status: ExchangeStatus;
  filename: string;
  fileSize: number;
  recordCount: number;
  receivedAt: string;
  completedAt: string | null;
  schemaVersion: string;
  correlationId: string;
  errorCount: number;
  validationErrors: ExchangeValidationError[];
}
