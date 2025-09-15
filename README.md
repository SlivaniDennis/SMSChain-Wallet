# SMSChain Wallet

## Overview

SMSChain Wallet is a Web3 project designed to promote financial inclusion by enabling non-smartphone users to interact with blockchain-based wallets and transactions via SMS. Built on the Stacks blockchain using Clarity smart contracts, it leverages light clients for efficient transaction verification and processing. This addresses real-world problems such as:

- **Financial Exclusion in Developing Regions**: Many people in low-income or rural areas lack smartphones or reliable internet but have access to basic feature phones with SMS capabilities. Traditional crypto wallets exclude them, limiting access to decentralized finance (DeFi), remittances, and payments.
- **High Remittance Fees and Delays**: Cross-border money transfers often incur high fees (up to 7% globally) and delays. SMSChain enables low-cost, near-instant P2P transfers secured by blockchain.
- **Digital Divide**: By integrating SMS with light clients (which run on minimal resources), users can verify transactions without full node requirements, making blockchain accessible on basic devices.
- **Security and Trust Issues**: Centralized SMS-based banking is prone to hacks; SMSChain uses decentralized smart contracts for trustless operations.

The system works as follows:
- Users register via SMS or a simple web/app interface.
- Transactions (e.g., send/receive STX or custom tokens) are initiated via SMS commands (e.g., "SEND 10 STX TO +123456789").
- An off-chain SMS gateway (integrated with services like Twilio) relays commands to the blockchain via light clients.
- Light clients (e.g., based on Stacks' Hiro Wallet light mode) verify proofs without downloading the full chain.
- Smart contracts handle authentication, balances, and executions securely.

This project involves 6 core Clarity smart contracts for robustness, security, and modularity.

## Tech Stack
- **Blockchain**: Stacks (Bitcoin-secured Layer 2).
- **Smart Contract Language**: Clarity (secure, decidable language for predictable execution).
- **Off-Chain Components**: SMS gateway (e.g., Node.js with Twilio API), light client integration (e.g., Stacks.js library).
- **User Interfaces**: SMS for non-smartphone users; optional mobile/web app for smartphone users.

## Smart Contracts

The project uses 6 solid Clarity smart contracts to manage user interactions, security, and transactions. Each is designed for clarity (pun intended), with error handling, access controls, and event emissions for off-chain monitoring. Contracts are modular to allow upgrades via governance.

### 1. UserRegistry.clar
This contract handles user registration, linking phone numbers to Stacks addresses. It prevents duplicate registrations and emits events for verification.

```clarity
;; UserRegistry Contract
(define-trait sms-verifier-trait
  ((verify-sms (principal uint (buff 32)) (response bool uint))))

(define-map users principal { phone: (buff 20), verified: bool, nonce: uint })

(define-public (register-user (phone (buff 20)) (verifier principal))
  (let ((caller tx-sender))
    (asserts! (is-none (map-get? users caller)) (err u100)) ;; No duplicates
    (map-set users caller { phone: phone, verified: false, nonce: u0 })
    (try! (contract-call? verifier verify-sms caller (len phone) phone))
    (ok true)))

(define-public (verify-user (nonce uint))
  (let ((caller tx-sender) (entry (unwrap! (map-get? users caller) (err u101))))
    (asserts! (is-eq (get nonce entry) nonce) (err u102))
    (map-set users caller (merge entry { verified: true }))
    (ok true)))

(define-read-only (get-user (user principal))
  (map-get? users user))
```

### 2. AuthContract.clar
Manages SMS-based authentication using challenges (e.g., OTPs). It integrates with an oracle for off-chain SMS verification to prevent spoofing.

```clarity
;; AuthContract Contract
(define-map challenges principal { challenge: (buff 32), expiry: uint })

(define-public (request-challenge)
  (let ((caller tx-sender) (challenge (sha256 (fold + (list (block-height) (var-get nonce)) u0))))
    (map-set challenges caller { challenge: challenge, expiry: (+ (block-height) u10) })
    (var-set nonce (+ (var-get nonce) u1))
    ;; Emit event for off-chain SMS sending
    (print { event: "challenge-requested", user: caller, challenge: challenge })
    (ok challenge)))

(define-public (verify-challenge (response (buff 32)))
  (let ((caller tx-sender) (entry (unwrap! (map-get? users caller) (err u200))))
    (asserts! (< (block-height) (get expiry entry)) (err u201))
    (asserts! (is-eq (sha256 response) (get challenge entry)) (err u202))
    (map-delete challenges caller)
    (ok true)))

(define-data-var nonce uint u0)
```

### 3. WalletContract.clar
Core wallet for managing balances of STX and SIP-10 tokens. Supports deposits/withdrawals via light client proofs.

```clarity
;; WalletContract Contract
(use-trait ft-trait .sip-010-trait.ft-trait)

(define-map balances { user: principal, token: principal } uint)

(define-public (deposit (amount uint) (token <ft-trait>))
  (let ((caller tx-sender))
    (try! (contract-call? token transfer amount caller (as-contract tx-sender) none))
    (map-set balances { user: caller, token: (contract-of token) }
      (+ (default-to u0 (map-get? balances { user: caller, token: (contract-of token) })) amount))
    (ok amount)))

(define-public (withdraw (amount uint) (token <ft-trait>))
  (let ((caller tx-sender) (balance (unwrap! (map-get? balances { user: caller, token: (contract-of token) }) (err u300))))
    (asserts! (>= balance amount) (err u301))
    (try! (as-contract (contract-call? token transfer amount tx-sender caller none)))
    (map-set balances { user: caller, token: (contract-of token) } (- balance amount))
    (ok amount)))

(define-read-only (get-balance (user principal) (token principal))
  (default-to u0 (map-get? balances { user: user, token: token })))
```

### 4. TransferContract.clar
Handles P2P transfers, initiated via SMS. Uses light clients for merkle proofs to verify transaction inclusion without full chain download.

```clarity
;; TransferContract Contract
(define-public (transfer (recipient principal) (amount uint) (token <ft-trait>) (proof (buff 1024)))
  (let ((sender tx-sender))
    ;; Verify light client proof (simplified; in practice, use Stacks' proof lib)
    (asserts! (is-valid-proof proof sender recipient amount) (err u400))
    (try! (contract-call? .wallet-contract withdraw amount token))
    (try! (contract-call? .wallet-contract deposit amount token))
    (print { event: "transfer", from: sender, to: recipient, amount: amount })
    (ok true)))

(define-private (is-valid-proof (proof (buff 1024)) (sender principal) (recipient principal) (amount uint))
  ;; Placeholder for merkle proof verification logic
  true)
```

### 5. EscrowContract.clar
For secure remittances: Sender locks funds in escrow, recipient claims via SMS-verified auth. Prevents fraud in cross-border transfers.

```clarity
;; EscrowContract Contract
(define-map escrows uint { sender: principal, recipient: principal, amount: uint, token: principal, expiry: uint, claimed: bool })

(define-data-var escrow-id uint u0)

(define-public (create-escrow (recipient principal) (amount uint) (token <ft-trait>) (expiry uint))
  (let ((sender tx-sender) (id (var-get escrow-id)))
    (try! (contract-call? .wallet-contract withdraw amount token))
    (map-set escrows id { sender: sender, recipient: recipient, amount: amount, token: (contract-of token), expiry: expiry, claimed: false })
    (var-set escrow-id (+ id u1))
    (ok id)))

(define-public (claim-escrow (id uint))
  (let ((caller tx-sender) (escrow (unwrap! (map-get? escrows id) (err u500))))
    (asserts! (is-eq caller (get recipient escrow)) (err u501))
    (asserts! (not (get claimed escrow)) (err u502))
    (asserts! (< (block-height) (get expiry escrow)) (err u503))
    (try! (contract-call? .auth-contract verify-challenge (get challenge-for-claim id))) ;; SMS auth
    (try! (contract-call? .wallet-contract deposit (get amount escrow) (get token escrow)))
    (map-set escrows id (merge escrow { claimed: true }))
    (ok true)))

(define-public (refund-escrow (id uint))
  (let ((caller tx-sender) (escrow (unwrap! (map-get? escrows id) (err u504))))
    (asserts! (is-eq caller (get sender escrow)) (err u505))
    (asserts! (> (block-height) (get expiry escrow)) (err u506))
    (try! (contract-call? .wallet-contract deposit (get amount escrow) (get token escrow)))
    (map-delete escrows id)
    (ok true)))
```

### 6. OracleContract.clar
Provides off-chain data (e.g., exchange rates for fiat remittances) via trusted oracles. Used for converting SMS-requested fiat amounts to crypto.

```clarity
;; OracleContract Contract
(define-map rates (buff 10) uint) ;; e.g., "USD-STX" -> rate

(define-trait oracle-trait
  ((update-rate ((buff 10) uint) (response bool uint))))

(define-public (update-rate (pair (buff 10)) (rate uint) (oracle principal))
  (asserts! (is-eq oracle (var-get trusted-oracle)) (err u600))
  (map-set rates pair rate)
  (ok true))

(define-read-only (get-rate (pair (buff 10)))
  (map-get? rates pair))

(define-data-var trusted-oracle principal 'SP000000000000000000002Q6VF78) ;; Example principal
```

## Deployment and Usage
1. **Deploy Contracts**: Use Stacks CLI to deploy on testnet/mainnet.
2. **Integrate SMS Gateway**: Build a Node.js server to listen for contract events and send/receive SMS.
3. **Light Client Integration**: Use Stacks.js for mobile light clients to submit txs.
4. **Testing**: Simulate SMS via tools like Twilio sandbox.
5. **Real-World Impact**: Partner with NGOs for remittances in Africa/Asia.

## Future Enhancements
- Multi-token support.
- Privacy via zero-knowledge proofs.
- Governance for oracle updates.

## License
MIT License. See LICENSE file for details.