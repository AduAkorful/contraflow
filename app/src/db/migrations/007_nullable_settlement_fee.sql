-- Circle may confirm a Developer-Controlled Wallet transaction without returning networkFee.
-- NULL means the fee is unknown; zero is a measured value and must not be used as a substitute.
ALTER TABLE settlements ALTER COLUMN gas_paid_wei DROP NOT NULL;
