import { describe, it, expect, beforeEach } from "vitest";
import { principalCV, uintCV, stringUtf8CV, bufferCV } from "@stacks/transactions";

const ERR_INVALID_AMOUNT = 101;
const ERR_INSUFFICIENT_BALANCE = 102;
const ERR_TOKEN_NOT_SUPPORTED = 103;
const ERR_WALLET_PAUSED = 104;
const ERR_INVALID_RECIPIENT = 105;
const ERR_INVALID_MIN_DEPOSIT = 111;
const ERR_INVALID_MAX_WITHDRAW = 112;
const ERR_OWNER_ONLY = 110;
const ERR_ALREADY_PAUSED = 124;
const ERR_NOT_PAUSED = 125;
const ERR_INVALID_FEE_RATE = 107;
const ERR_TRANSFER_FAILED = 113;

interface History {
  user: string;
  amount: number;
  token: string;
  timestamp: number;
  txId: Uint8Array;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

interface FtTrait {
  transfer: (amount: number, from: string, to: string) => Result<boolean>;
  getBalance: (user: string) => Result<number>;
}

class MockToken implements FtTrait {
  balances: Map<string, number> = new Map();
  transfers: Array<{ amount: number; from: string; to: string }> = [];

  transfer(amount: number, from: string, to: string): Result<boolean> {
    const fromBal = this.balances.get(from) || 0;
    if (fromBal < amount) return { ok: false, value: false };
    this.balances.set(from, fromBal - amount);
    const toBal = this.balances.get(to) || 0;
    this.balances.set(to, toBal + amount);
    this.transfers.push({ amount, from, to });
    return { ok: true, value: true };
  }

  getBalance(user: string): Result<number> {
    return { ok: true, value: this.balances.get(user) || 0 };
  }
}

class WalletContractMock {
  state: {
    owner: string;
    paused: boolean;
    feeRate: number;
    minDeposit: number;
    maxWithdraw: number;
    maxDeposits: number;
    nextHistoryId: number;
    maxHistory: number;
    balances: Map<string, number>;
    supportedTokens: Set<string>;
    depositHistory: Map<number, History>;
    withdrawHistory: Map<number, History>;
  } = {
    owner: "",
    paused: false,
    feeRate: 0,
    minDeposit: 100,
    maxWithdraw: 1000000,
    maxDeposits: 1000,
    nextHistoryId: 0,
    maxHistory: 500,
    balances: new Map(),
    supportedTokens: new Set(),
    depositHistory: new Map(),
    withdrawHistory: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
  stxBalances: Map<string, number> = new Map();
  stxTransfers: Array<{ amount: number; from: string; to: string }> = [];
  events: Array<object> = [];
  txId: Uint8Array = new Uint8Array([0]);

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      owner: this.caller,
      paused: false,
      feeRate: 0,
      minDeposit: 100,
      maxWithdraw: 1000000,
      maxDeposits: 1000,
      nextHistoryId: 0,
      maxHistory: 500,
      balances: new Map(),
      supportedTokens: new Set(),
      depositHistory: new Map(),
      withdrawHistory: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    this.stxBalances.set(this.caller, 1000000);
    this.stxTransfers = [];
    this.events = [];
    this.txId = new Uint8Array([0]);
  }

  private getBalanceKey(user: string, token: string): string {
    return `${user}-${token}`;
  }

  getBalance(user: string, token: string): number {
    return this.state.balances.get(this.getBalanceKey(user, token)) || 0;
  }

  getDepositHistory(id: number): History | undefined {
    return this.state.depositHistory.get(id);
  }

  getWithdrawHistory(id: number): History | undefined {
    return this.state.withdrawHistory.get(id);
  }

  isTokenSupported(token: string): boolean {
    return this.state.supportedTokens.has(token);
  }

  getOwner(): Result<string> {
    return { ok: true, value: this.state.owner };
  }

  isPaused(): Result<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getFeeRate(): Result<number> {
    return { ok: true, value: this.state.feeRate };
  }

  getMinDeposit(): Result<number> {
    return { ok: true, value: this.state.minDeposit };
  }

  getMaxWithdraw(): Result<number> {
    return { ok: true, value: this.state.maxWithdraw };
  }

  setOwner(newOwner: string): Result<boolean> {
    if (this.caller !== this.state.owner) return { ok: false, value: false };
    if (newOwner === "SP000000000000000000002Q6VF78") return { ok: false, value: false };
    this.state.owner = newOwner;
    return { ok: true, value: true };
  }

  pauseWallet(): Result<boolean> {
    if (this.caller !== this.state.owner) return { ok: false, value: false };
    if (this.state.paused) return { ok: false, value: false };
    this.state.paused = true;
    this.events.push({ event: "wallet-paused" });
    return { ok: true, value: true };
  }

  unpauseWallet(): Result<boolean> {
    if (this.caller !== this.state.owner) return { ok: false, value: false };
    if (!this.state.paused) return { ok: false, value: false };
    this.state.paused = false;
    this.events.push({ event: "wallet-unpaused" });
    return { ok: true, value: true };
  }

  setFeeRate(newRate: number): Result<boolean> {
    if (this.caller !== this.state.owner) return { ok: false, value: false };
    if (newRate > 100) return { ok: false, value: false };
    this.state.feeRate = newRate;
    return { ok: true, value: true };
  }

  setMinDeposit(newMin: number): Result<boolean> {
    if (this.caller !== this.state.owner) return { ok: false, value: false };
    if (newMin <= 0) return { ok: false, value: false };
    this.state.minDeposit = newMin;
    return { ok: true, value: true };
  }

  setMaxWithdraw(newMax: number): Result<boolean> {
    if (this.caller !== this.state.owner) return { ok: false, value: false };
    if (newMax <= 0) return { ok: false, value: false };
    this.state.maxWithdraw = newMax;
    return { ok: true, value: true };
  }

  addSupportedToken(token: string): Result<boolean> {
    if (this.caller !== this.state.owner) return { ok: false, value: false };
    this.state.supportedTokens.add(token);
    return { ok: true, value: true };
  }

  removeSupportedToken(token: string): Result<boolean> {
    if (this.caller !== this.state.owner) return { ok: false, value: false };
    this.state.supportedTokens.delete(token);
    return { ok: true, value: true };
  }

  depositStx(amount: number): Result<number> {
    if (this.state.paused) return { ok: false, value: ERR_WALLET_PAUSED };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (amount < this.state.minDeposit) return { ok: false, value: ERR_INVALID_MIN_DEPOSIT };
    const fee = Math.floor((amount * this.state.feeRate) / 10000);
    const netAmount = amount - fee;
    const callerBal = this.stxBalances.get(this.caller) || 0;
    if (callerBal < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    if (fee > 0) {
      this.stxBalances.set(this.caller, callerBal - fee);
      const ownerBal = this.stxBalances.get(this.state.owner) || 0;
      this.stxBalances.set(this.state.owner, ownerBal + fee);
      this.stxTransfers.push({ amount: fee, from: this.caller, to: this.state.owner });
    }
    this.stxBalances.set(this.caller, (this.stxBalances.get(this.caller) || 0) - netAmount);
    const contractBal = this.stxBalances.get("contract") || 0;
    this.stxBalances.set("contract", contractBal + netAmount);
    this.stxTransfers.push({ amount: netAmount, from: this.caller, to: "contract" });
    const token = "SP000000000000000000002Q6VF78";
    const key = this.getBalanceKey(this.caller, token);
    this.state.balances.set(key, (this.state.balances.get(key) || 0) + netAmount);
    const id = this.state.nextHistoryId;
    this.state.depositHistory.set(id, { user: this.caller, amount: netAmount, token, timestamp: this.blockHeight, txId: this.txId });
    this.state.nextHistoryId++;
    this.events.push({ event: "stx-deposited", user: this.caller, amount: netAmount });
    return { ok: true, value: netAmount };
  }

  depositToken(amount: number, token: MockToken, tokenPrinc: string): Result<number> {
    if (this.state.paused) return { ok: false, value: ERR_WALLET_PAUSED };
    if (!this.isTokenSupported(tokenPrinc)) return { ok: false, value: ERR_TOKEN_NOT_SUPPORTED };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (amount < this.state.minDeposit) return { ok: false, value: ERR_INVALID_MIN_DEPOSIT };
    const fee = Math.floor((amount * this.state.feeRate) / 10000);
    const netAmount = amount - fee;
    if (fee > 0) {
      const feeRes = token.transfer(fee, this.caller, this.state.owner);
      if (!feeRes.ok) return { ok: false, value: ERR_TRANSFER_FAILED };
    }
    const depRes = token.transfer(netAmount, this.caller, "contract");
    if (!depRes.ok) return { ok: false, value: ERR_TRANSFER_FAILED };
    const key = this.getBalanceKey(this.caller, tokenPrinc);
    this.state.balances.set(key, (this.state.balances.get(key) || 0) + netAmount);
    const id = this.state.nextHistoryId;
    this.state.depositHistory.set(id, { user: this.caller, amount: netAmount, token: tokenPrinc, timestamp: this.blockHeight, txId: this.txId });
    this.state.nextHistoryId++;
    this.events.push({ event: "token-deposited", user: this.caller, token: tokenPrinc, amount: netAmount });
    return { ok: true, value: netAmount };
  }

  withdrawStx(amount: number): Result<number> {
    if (this.state.paused) return { ok: false, value: ERR_WALLET_PAUSED };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (amount > this.state.maxWithdraw) return { ok: false, value: ERR_INVALID_MAX_WITHDRAW };
    const token = "SP000000000000000000002Q6VF78";
    const key = this.getBalanceKey(this.caller, token);
    const balance = this.state.balances.get(key) || 0;
    if (balance < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    const fee = Math.floor((amount * this.state.feeRate) / 10000);
    const netAmount = amount - fee;
    if (fee > 0) {
      const contractBal = this.stxBalances.get("contract") || 0;
      this.stxBalances.set("contract", contractBal - fee);
      const ownerBal = this.stxBalances.get(this.state.owner) || 0;
      this.stxBalances.set(this.state.owner, ownerBal + fee);
      this.stxTransfers.push({ amount: fee, from: "contract", to: this.state.owner });
    }
    const contractBal = this.stxBalances.get("contract") || 0;
    this.stxBalances.set("contract", contractBal - netAmount);
    const callerBal = this.stxBalances.get(this.caller) || 0;
    this.stxBalances.set(this.caller, callerBal + netAmount);
    this.stxTransfers.push({ amount: netAmount, from: "contract", to: this.caller });
    this.state.balances.set(key, balance - amount);
    const id = this.state.nextHistoryId;
    this.state.withdrawHistory.set(id, { user: this.caller, amount: netAmount, token, timestamp: this.blockHeight, txId: this.txId });
    this.state.nextHistoryId++;
    this.events.push({ event: "stx-withdrawn", user: this.caller, amount: netAmount });
    return { ok: true, value: netAmount };
  }

  withdrawToken(amount: number, token: MockToken, tokenPrinc: string): Result<number> {
    if (this.state.paused) return { ok: false, value: ERR_WALLET_PAUSED };
    if (!this.isTokenSupported(tokenPrinc)) return { ok: false, value: ERR_TOKEN_NOT_SUPPORTED };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (amount > this.state.maxWithdraw) return { ok: false, value: ERR_INVALID_MAX_WITHDRAW };
    const key = this.getBalanceKey(this.caller, tokenPrinc);
    const balance = this.state.balances.get(key) || 0;
    if (balance < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    const fee = Math.floor((amount * this.state.feeRate) / 10000);
    const netAmount = amount - fee;
    if (fee > 0) {
      const feeRes = token.transfer(fee, "contract", this.state.owner);
      if (!feeRes.ok) return { ok: false, value: ERR_TRANSFER_FAILED };
    }
    const withRes = token.transfer(netAmount, "contract", this.caller);
    if (!withRes.ok) return { ok: false, value: ERR_TRANSFER_FAILED };
    this.state.balances.set(key, balance - amount);
    const id = this.state.nextHistoryId;
    this.state.withdrawHistory.set(id, { user: this.caller, amount: netAmount, token: tokenPrinc, timestamp: this.blockHeight, txId: this.txId });
    this.state.nextHistoryId++;
    this.events.push({ event: "token-withdrawn", user: this.caller, token: tokenPrinc, amount: netAmount });
    return { ok: true, value: netAmount };
  }

  transferInternal(recipient: string, amount: number, token: string): Result<number> {
    if (this.state.paused) return { ok: false, value: ERR_WALLET_PAUSED };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (recipient === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_INVALID_RECIPIENT };
    const senderKey = this.getBalanceKey(this.caller, token);
    const senderBal = this.state.balances.get(senderKey) || 0;
    if (senderBal < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    const recipKey = this.getBalanceKey(recipient, token);
    const recipBal = this.state.balances.get(recipKey) || 0;
    this.state.balances.set(senderKey, senderBal - amount);
    this.state.balances.set(recipKey, recipBal + amount);
    this.events.push({ event: "internal-transfer", from: this.caller, to: recipient, amount, token });
    return { ok: true, value: amount };
  }
}

describe("WalletContract", () => {
  let contract: WalletContractMock;

  beforeEach(() => {
    contract = new WalletContractMock();
    contract.reset();
  });

  it("deposits STX successfully", () => {
    const result = contract.depositStx(500);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(500);
    expect(contract.getBalance("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "SP000000000000000000002Q6VF78")).toBe(500);
    expect(contract.events[0]).toEqual({ event: "stx-deposited", user: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", amount: 500 });
  });

  it("rejects deposit when paused", () => {
    contract.pauseWallet();
    const result = contract.depositStx(500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_WALLET_PAUSED);
  });

  it("applies fee on deposit", () => {
    contract.setFeeRate(100);
    const result = contract.depositStx(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(990);
    expect(contract.getBalance("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "SP000000000000000000002Q6VF78")).toBe(990);
  });

  it("withdraws STX successfully", () => {
    contract.depositStx(1000);
    const result = contract.withdrawStx(500);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(500);
    expect(contract.getBalance("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "SP000000000000000000002Q6VF78")).toBe(500);
  });

  it("rejects withdraw with insufficient balance", () => {
    const result = contract.withdrawStx(500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_BALANCE);
  });

  it("adds and removes supported token", () => {
    const token = "ST2TOKEN";
    contract.addSupportedToken(token);
    expect(contract.isTokenSupported(token)).toBe(true);
    contract.removeSupportedToken(token);
    expect(contract.isTokenSupported(token)).toBe(false);
  });

  it("deposits token successfully", () => {
    const tokenPrinc = "ST2TOKEN";
    contract.addSupportedToken(tokenPrinc);
    const mockToken = new MockToken();
    mockToken.balances.set("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", 1000);
    const result = contract.depositToken(500, mockToken, tokenPrinc);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(500);
    expect(contract.getBalance("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", tokenPrinc)).toBe(500);
  });

  it("withdraws token successfully", () => {
    const tokenPrinc = "ST2TOKEN";
    contract.addSupportedToken(tokenPrinc);
    const mockToken = new MockToken();
    mockToken.balances.set("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", 1000);
    contract.depositToken(1000, mockToken, tokenPrinc);
    const result = contract.withdrawToken(500, mockToken, tokenPrinc);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(500);
    expect(contract.getBalance("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", tokenPrinc)).toBe(500);
  });

  it("transfers internally successfully", () => {
    contract.depositStx(1000);
    const recipient = "ST3RECIP";
    const result = contract.transferInternal(recipient, 300, "SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(300);
    expect(contract.getBalance("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "SP000000000000000000002Q6VF78")).toBe(700);
    expect(contract.getBalance(recipient, "SP000000000000000000002Q6VF78")).toBe(300);
  });

  it("rejects internal transfer to invalid recipient", () => {
    contract.depositStx(1000);
    const result = contract.transferInternal("SP000000000000000000002Q6VF78", 300, "SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_RECIPIENT);
  });

  it("sets owner successfully", () => {
    const newOwner = "ST4NEW";
    const result = contract.setOwner(newOwner);
    expect(result.ok).toBe(true);
    expect(contract.getOwner().value).toBe(newOwner);
  });

  it("rejects set owner by non-owner", () => {
    contract.caller = "ST5FAKE";
    const result = contract.setOwner("ST6NEW");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("pauses and unpauses wallet", () => {
    const pauseRes = contract.pauseWallet();
    expect(pauseRes.ok).toBe(true);
    expect(contract.isPaused().value).toBe(true);
    const unpauseRes = contract.unpauseWallet();
    expect(unpauseRes.ok).toBe(true);
    expect(contract.isPaused().value).toBe(false);
  });

  it("records deposit history", () => {
    contract.depositStx(500);
    const history = contract.getDepositHistory(0);
    expect(history?.amount).toBe(500);
    expect(history?.user).toBe("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM");
  });

  it("records withdraw history", () => {
    contract.depositStx(1000);
    contract.withdrawStx(500);
    const history = contract.getWithdrawHistory(1);
    expect(history?.amount).toBe(500);
    expect(history?.user).toBe("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM");
  });

  it("rejects deposit below min", () => {
    const result = contract.depositStx(50);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_MIN_DEPOSIT);
  });

  it("rejects withdraw above max", () => {
    contract.depositStx(2000000);
    contract.setMaxWithdraw(1000000);
    const result = contract.withdrawStx(1500000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_MAX_WITHDRAW);
  });

  it("sets fee rate successfully", () => {
    const result = contract.setFeeRate(50);
    expect(result.ok).toBe(true);
    expect(contract.getFeeRate().value).toBe(50);
  });

  it("rejects invalid fee rate", () => {
    const result = contract.setFeeRate(150);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
});