(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-INSUFFICIENT-BALANCE u102)
(define-constant ERR-TOKEN-NOT-SUPPORTED u103)
(define-constant ERR-WALLET-PAUSED u104)
(define-constant ERR-INVALID-RECIPIENT u105)
(define-constant ERR-MAX-DEPOSITS-EXCEEDED u106)
(define-constant ERR-INVALID-FEE-RATE u107)
(define-constant ERR-HISTORY-NOT-FOUND u108)
(define-constant ERR-INVALID-TIMESTAMP u109)
(define-constant ERR-OWNER-ONLY u110)
(define-constant ERR-INVALID-MIN-DEPOSIT u111)
(define-constant ERR-INVALID-MAX-WITHDRAW u112)
(define-constant ERR-TRANSFER-FAILED u113)
(define-constant ERR-DEPOSIT-FAILED u114)
(define-constant ERR-WITHDRAW-FAILED u115)
(define-constant ERR-INVALID-TOKEN u116)
(define-constant ERR-INVALID-HISTORY-ID u117)
(define-constant ERR-PAUSE-NOT-ALLOWED u118)
(define-constant ERR-FEE-TRANSFER-FAILED u119)
(define-constant ERR-INVALID-OWNER u120)
(define-constant ERR-INVALID-PARAM u121)
(define-constant ERR-MAX-HISTORY-EXCEEDED u122)
(define-constant ERR-INVALID-CURRENCY u123)
(define-constant ERR-ALREADY-PAUSED u124)
(define-constant ERR-NOT-PAUSED u125)

(define-data-var owner principal tx-sender)
(define-data-var paused bool false)
(define-data-var fee-rate uint u0)
(define-data-var min-deposit uint u100)
(define-data-var max-withdraw uint u1000000)
(define-data-var max-deposits uint u1000)
(define-data-var next-history-id uint u0)
(define-data-var max-history uint u500)

(define-map balances 
  { user: principal, token: principal } 
  uint)

(define-map supported-tokens 
  principal 
  bool)

(define-map deposit-history 
  uint 
  { user: principal, amount: uint, token: principal, timestamp: uint, tx-id: (buff 32) })

(define-map withdraw-history 
  uint 
  { user: principal, amount: uint, token: principal, timestamp: uint, tx-id: (buff 32) })

(define-trait ft-trait
  (
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
    (get-balance (principal) (response uint uint))
  )
)

(define-read-only (get-balance (user principal) (token principal))
  (default-to u0 (map-get? balances { user: user, token: token })))

(define-read-only (get-deposit-history (id uint))
  (map-get? deposit-history id))

(define-read-only (get-withdraw-history (id uint))
  (map-get? withdraw-history id))

(define-read-only (is-token-supported (token principal))
  (default-to false (map-get? supported-tokens token)))

(define-read-only (get-owner)
  (ok (var-get owner)))

(define-read-only (is-paused)
  (ok (var-get paused)))

(define-read-only (get-fee-rate)
  (ok (var-get fee-rate)))

(define-read-only (get-min-deposit)
  (ok (var-get min-deposit)))

(define-read-only (get-max-withdraw)
  (ok (var-get max-withdraw)))

(define-private (validate-amount (amount uint))
  (if (> amount u0)
    (ok true)
    (err ERR-INVALID-AMOUNT)))

(define-private (validate-recipient (recipient principal))
  (if (not (is-eq recipient 'SP000000000000000000002Q6VF78))
    (ok true)
    (err ERR-INVALID-RECIPIENT)))

(define-private (validate-token (token principal))
  (if (is-token-supported token)
    (ok true)
    (err ERR-TOKEN-NOT-SUPPORTED)))

(define-private (validate-owner (caller principal))
  (if (is-eq caller (var-get owner))
    (ok true)
    (err ERR-OWNER-ONLY)))

(define-private (validate-not-paused)
  (if (not (var-get paused))
    (ok true)
    (err ERR-WALLET-PAUSED)))

(define-private (validate-min-deposit (amount uint))
  (if (>= amount (var-get min-deposit))
    (ok true)
    (err ERR-INVALID-MIN-DEPOSIT)))

(define-private (validate-max-withdraw (amount uint))
  (if (<= amount (var-get max-withdraw))
    (ok true)
    (err ERR-INVALID-MAX-WITHDRAW)))

(define-private (validate-fee-rate (rate uint))
  (if (<= rate u100)
    (ok true)
    (err ERR-INVALID-FEE-RATE)))

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
    (ok true)
    (err ERR-INVALID-TIMESTAMP)))

(define-private (calculate-fee (amount uint))
  (/ (* amount (var-get fee-rate)) u10000))

(define-public (set-owner (new-owner principal))
  (begin
    (try! (validate-owner tx-sender))
    (try! (validate-recipient new-owner))
    (var-set owner new-owner)
    (ok true)))

(define-public (pause-wallet)
  (begin
    (try! (validate-owner tx-sender))
    (asserts! (not (var-get paused)) (err ERR-ALREADY-PAUSED))
    (var-set paused true)
    (print { event: "wallet-paused" })
    (ok true)))

(define-public (unpause-wallet)
  (begin
    (try! (validate-owner tx-sender))
    (asserts! (var-get paused) (err ERR-NOT-PAUSED))
    (var-set paused false)
    (print { event: "wallet-unpaused" })
    (ok true)))

(define-public (set-fee-rate (new-rate uint))
  (begin
    (try! (validate-owner tx-sender))
    (try! (validate-fee-rate new-rate))
    (var-set fee-rate new-rate)
    (ok true)))

(define-public (set-min-deposit (new-min uint))
  (begin
    (try! (validate-owner tx-sender))
    (try! (validate-amount new-min))
    (var-set min-deposit new-min)
    (ok true)))

(define-public (set-max-withdraw (new-max uint))
  (begin
    (try! (validate-owner tx-sender))
    (try! (validate-amount new-max))
    (var-set max-withdraw new-max)
    (ok true)))

(define-public (add-supported-token (token principal))
  (begin
    (try! (validate-owner tx-sender))
    (map-set supported-tokens token true)
    (ok true)))

(define-public (remove-supported-token (token principal))
  (begin
    (try! (validate-owner tx-sender))
    (map-delete supported-tokens token)
    (ok true)))

(define-public (deposit-stx (amount uint))
  (let ((caller tx-sender)
        (fee (calculate-fee amount))
        (net-amount (- amount fee))
        (stx-token 'SP000000000000000000002Q6VF78))
    (try! (validate-not-paused))
    (try! (validate-amount amount))
    (try! (validate-min-deposit amount))
    (if (> fee u0)
      (try! (stx-transfer? fee caller (var-get owner)))
      (ok true))
    (try! (stx-transfer? net-amount caller (as-contract tx-sender)))
    (map-set balances { user: caller, token: stx-token } 
      (+ (default-to u0 (map-get? balances { user: caller, token: stx-token })) net-amount))
    (let ((id (var-get next-history-id)))
      (map-set deposit-history id { user: caller, amount: net-amount, token: stx-token, timestamp: block-height, tx-id: (get-block-info? id-header-hash block-height) })
      (var-set next-history-id (+ id u1)))
    (print { event: "stx-deposited", user: caller, amount: net-amount })
    (ok net-amount)))

(define-public (deposit-token (amount uint) (token <ft-trait>))
  (let ((caller tx-sender)
        (token-princ (contract-of token))
        (fee (calculate-fee amount))
        (net-amount (- amount fee)))
    (try! (validate-not-paused))
    (try! (validate-token token-princ))
    (try! (validate-amount amount))
    (try! (validate-min-deposit amount))
    (if (> fee u0)
      (try! (contract-call? token transfer fee caller (var-get owner) none))
      (ok true))
    (try! (contract-call? token transfer net-amount caller (as-contract tx-sender) none))
    (map-set balances { user: caller, token: token-princ } 
      (+ (default-to u0 (map-get? balances { user: caller, token: token-princ })) net-amount))
    (let ((id (var-get next-history-id)))
      (map-set deposit-history id { user: caller, amount: net-amount, token: token-princ, timestamp: block-height, tx-id: (get-block-info? id-header-hash block-height) })
      (var-set next-history-id (+ id u1)))
    (print { event: "token-deposited", user: caller, token: token-princ, amount: net-amount })
    (ok net-amount)))

(define-public (withdraw-stx (amount uint))
  (let ((caller tx-sender)
        (stx-token 'SP000000000000000000002Q6VF78)
        (balance (get-balance caller stx-token))
        (fee (calculate-fee amount))
        (net-amount (- amount fee)))
    (try! (validate-not-paused))
    (try! (validate-amount amount))
    (try! (validate-max-withdraw amount))
    (asserts! (>= balance amount) (err ERR-INSUFFICIENT-BALANCE))
    (if (> fee u0)
      (try! (as-contract (stx-transfer? fee tx-sender (var-get owner))))
      (ok true))
    (try! (as-contract (stx-transfer? net-amount tx-sender caller)))
    (map-set balances { user: caller, token: stx-token } (- balance amount))
    (let ((id (var-get next-history-id)))
      (map-set withdraw-history id { user: caller, amount: net-amount, token: stx-token, timestamp: block-height, tx-id: (get-block-info? id-header-hash block-height) })
      (var-set next-history-id (+ id u1)))
    (print { event: "stx-withdrawn", user: caller, amount: net-amount })
    (ok net-amount)))

(define-public (withdraw-token (amount uint) (token <ft-trait>))
  (let ((caller tx-sender)
        (token-princ (contract-of token))
        (balance (get-balance caller token-princ))
        (fee (calculate-fee amount))
        (net-amount (- amount fee)))
    (try! (validate-not-paused))
    (try! (validate-token token-princ))
    (try! (validate-amount amount))
    (try! (validate-max-withdraw amount))
    (asserts! (>= balance amount) (err ERR-INSUFFICIENT-BALANCE))
    (if (> fee u0)
      (try! (as-contract (contract-call? token transfer fee tx-sender (var-get owner) none)))
      (ok true))
    (try! (as-contract (contract-call? token transfer net-amount tx-sender caller none)))
    (map-set balances { user: caller, token: token-princ } (- balance amount))
    (let ((id (var-get next-history-id)))
      (map-set withdraw-history id { user: caller, amount: net-amount, token: token-princ, timestamp: block-height, tx-id: (get-block-info? id-header-hash block-height) })
      (var-set next-history-id (+ id u1)))
    (print { event: "token-withdrawn", user: caller, token: token-princ, amount: net-amount })
    (ok net-amount)))

(define-public (transfer-internal (recipient principal) (amount uint) (token principal))
  (let ((sender tx-sender)
        (sender-balance (get-balance sender token))
        (recipient-balance (get-balance recipient token)))
    (try! (validate-not-paused))
    (try! (validate-amount amount))
    (try! (validate-recipient recipient))
    (if (is-eq token 'SP000000000000000000002Q6VF78)
      (ok true)
      (try! (validate-token token)))
    (asserts! (>= sender-balance amount) (err ERR-INSUFFICIENT-BALANCE))
    (map-set balances { user: sender, token: token } (- sender-balance amount))
    (map-set balances { user: recipient, token: token } (+ recipient-balance amount))
    (print { event: "internal-transfer", from: sender, to: recipient, amount: amount, token: token })
    (ok amount)))