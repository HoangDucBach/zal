"""Mutation check: apply one bug at a time to src/, run the suite, report which tests kill it, restore.
Usage: mutate.py <contracts dir> [mutant name regex] [extra forge test args...]"""
import subprocess, sys, re, pathlib
root = pathlib.Path(sys.argv[1])
M = [
 ("INV-01 pool forgets to reduce outstanding", "src/ZalFundingPool.sol", "        outstanding -= adv.principal;\n", ""),
 ("INV-02 route bps sum unchecked", "src/CanvasAccount.sol", "if (legs.length != 0 && totalBps != BPS) revert InvalidRoute();", ""),
 ("INV-02 route leg count unchecked", "src/CanvasAccount.sol", "        if (legs.length > MAX_LEGS) revert InvalidRoute();\n", ""),
 ("INV-03 last leg gets floor share, not remainder", "src/CanvasAccount.sol", "uint256 part = i == count - 1 ? remaining : amount * leg.bps / BPS;", "uint256 part = amount * leg.bps / BPS;"),
 ("INV-04 pay does not check status", "src/ZalInvoice.sol", "        _requireStatus(id, inv, InvoiceStatus.Approved);\n        uint128 face = inv.faceValue;\n        bool fromEscrow", "        uint128 face = inv.faceValue;\n        bool fromEscrow"),
 ("INV-05/ZR-FND-03 no reserve check", "src/ZalFundingPool.sol", "if (quotedPrincipal + quotedFee > inv.faceValue) {", "if (false) {"),
 ("INV-06 funded invoice pays the seller", "src/ZalInvoice.sol", "address recipient = _ownerOf(id);", "address recipient = inv.seller;"),
 ("INV-07 escrow counter not reduced on pay", "src/ZalInvoice.sol", "            totalEscrowed -= face;\n", ""),
 ("INV-08 executed op can be confirmed again", "src/CanvasAccount.sol", "        if (op.executed) revert OpAlreadyExecuted(opId);\n", ""),
 ("INV-09/ZR-INV-04 transfer restriction removed", "src/ZalInvoice.sol", "msg.sender != to || from != inv.seller || to != factory.pool()", "false"),
 ("ZR-INV-04 seller may push the NFT to the pool", "src/ZalInvoice.sol", "msg.sender != to || from != inv.seller", "from != inv.seller"),
 ("ZR-ACC-05 stale op still confirms", "src/CanvasAccount.sol", "        if (op.policyNonce != policyNonce) revert OpStale(opId);\n", ""),
 ("ZR-ACC-08 receivePayment open to anyone", "src/CanvasAccount.sol", "        if (msg.sender != address(invoices) && msg.sender != pool) revert NotSettlement();\n", ""),
 ("ZR-FND-02 fee rounds down", "src/ZalFundingPool.sol", "BPS * YEAR, Math.Rounding.Ceil", "BPS * YEAR, Math.Rounding.Floor"),
 ("ZR-FND-05 maxWithdraw ignores idle cash", "src/ZalFundingPool.sol", "return Math.min(_convertToAssets(balanceOf(owner_), Math.Rounding.Floor), idleCash());", "return _convertToAssets(balanceOf(owner_), Math.Rounding.Floor);"),
 ("ZR-FND-05 maxRedeem ignores idle cash", "src/ZalFundingPool.sol", "return Math.min(balanceOf(owner_), _convertToShares(idleCash(), Math.Rounding.Floor));", "return balanceOf(owner_);"),
 ("ZR-FND-03 no idle cash check", "src/ZalFundingPool.sol", "if (quotedPrincipal > idle) revert InsufficientIdleCash(quotedPrincipal, idle);", ""),
 ("ZR-ACC-06 budget not enforced", "src/CanvasAccount.sol", "if (uint256(budget.used) + amount > budget.limit) {", "if (false) {"),
 ("ZR-ACC-03 any selector may be submitted", "src/CanvasAccount.sol", "        } else {\n            revert OpNotAllowed();\n        }", "        }"),
 ("ZR-ACC-02 last admin removable", "src/CanvasAccount.sol", "        if (adminCount == 0) revert LastAdmin();\n", ""),
 ("ZR-REL-01 duplicate relationship allowed", "src/RelationshipRegistry.sol", "if (old.status != RelStatus.Proposed || !_expired(old)) revert RelationshipExists(existing);", ""),
 ("ZR-REL-02 proposer may accept", "src/RelationshipRegistry.sol", "        if (msg.sender != counterparty) revert NotCounterparty();\n", ""),
 ("ZR-INV-03 escrow twice", "src/ZalInvoice.sol", "        if (inv.escrowed != 0) revert AlreadyEscrowed(id);\n", ""),
 ("ZR-SYS-01 wire twice", "src/ZalFactory.sol", "        if (usdc != address(0)) revert AlreadyWired();\n", ""),
 ("ZR-ACC-01 initialize twice", "src/CanvasAccount.sol", "        if (adminCount != 0) revert AlreadyInitialized();\n", ""),
 ("ZR-PAY-03 stranger may settle escrow before due date", "src/ZalInvoice.sol", "if (!isBuyer && !(fromEscrow && block.timestamp >= inv.dueDate)) revert NotPayable(id);", "if (!isBuyer && !fromEscrow) revert NotPayable(id);"),
 ("ZR-REL-03 invite nonce not consumed", "src/RelationshipRegistry.sol", "        inviteNonceUsed[invite.proposer][invite.nonce] = true;\n", ""),
 ("ZR-ACC-04 same approver counts twice", "src/CanvasAccount.sol", "        if (hasConfirmed[opId][msg.sender]) revert AlreadyConfirmed(opId);\n", ""),
 ("ZR-ACC-09 failed vault leg reverts", "src/CanvasAccount.sol", "        if (!ok) usdc.forceApprove(vault, 0);", "        if (!ok) revert InvalidRoute();"),
 ("ZR-ACC-09 short vault return counts as a deposit", "src/CanvasAccount.sol", "            ok := and(ok, gt(returndatasize(), 0x1f))\n", ""),
 ("ZR-ACC-09 failed vault leg keeps its allowance", "src/CanvasAccount.sol", "        if (!ok) usdc.forceApprove(vault, 0);\n", ""),
 ("ZR-ACC-09 route re-read from storage inside the loop", "src/CanvasAccount.sol", "Leg memory leg = route[i];", "Leg memory leg = _route[i];"),
 ("ZR-ACC-10 receivePayment nonReentrant again", "src/CanvasAccount.sol", "function receivePayment(uint256 invoiceId, uint256 amount) external {", "function receivePayment(uint256 invoiceId, uint256 amount) external nonReentrant {"),
 ("ZR-FND-07 unescrowed advance needs no limit", "src/ZalFundingPool.sol", "            if (required > limit) revert ObligorLimitExceeded(inv.buyer, required, limit);\n", ""),
 ("ZR-FND-07 every advance treated as escrowed", "src/ZalFundingPool.sol", "bool onCredit = inv.escrowed != inv.faceValue;", "bool onCredit = false;"),
 ("ZR-FND-07 escrowed advance needs a limit too", "src/ZalFundingPool.sol", "bool onCredit = inv.escrowed != inv.faceValue;", "bool onCredit = true;"),
 ("ZR-FND-07 limit off by one", "src/ZalFundingPool.sol", "if (required > limit) revert ObligorLimitExceeded", "if (required >= limit) revert ObligorLimitExceeded"),
 ("ZR-FND-07 setObligorLimit open to anyone", "src/ZalFundingPool.sol", "function setObligorLimit(address buyer, uint256 limit) external onlyOwner {", "function setObligorLimit(address buyer, uint256 limit) external {"),
 ("INV-10 advance not added to obligorOutstanding", "src/ZalFundingPool.sol", "            obligorOutstanding[inv.buyer] = required;\n", ""),
 ("INV-10 repayment does not reduce obligorOutstanding", "src/ZalFundingPool.sol", "        if (adv.onCredit) obligorOutstanding[inv.buyer] -= adv.principal;\n", ""),
 ("INV-10 advance not recorded as on credit", "src/ZalFundingPool.sol", "            onCredit: onCredit\n", "            onCredit: false\n"),
 ("INV-07 escrow counter not raised on escrow", "src/ZalInvoice.sol", "        totalEscrowed += face;\n", ""),
 ("ZR-SYS-02 Advanced event misreports the credit line", "src/ZalFundingPool.sol", "emit Advanced(invoiceId, inv.seller, principal, fee, onCredit);", "emit Advanced(invoiceId, inv.seller, principal, fee, false);"),
]
base = subprocess.run(["forge", "test"], cwd=root, capture_output=True, text=True)
assert base.returncode == 0, "baseline suite must be green before mutating:\n" + (base.stdout + base.stderr)[-2000:]
print("baseline green")
bad = 0
only = re.compile(sys.argv[2]) if len(sys.argv) > 2 else re.compile("")
for name, f, a, b in M:
    if not only.search(name): continue
    p = root / f
    orig = p.read_text()
    assert orig.count(a) == 1, (name, orig.count(a))
    p.write_text(orig.replace(a, b))
    try:
        r = subprocess.run(["forge", "test", *sys.argv[3:]], cwd=root, capture_output=True, text=True)
        out = r.stdout + r.stderr
        killers = sorted(set(re.findall(r"^\[FAIL.*\] (\w+)", out, re.M)))
        assert "Compiler run failed" not in out, (name, "mutant does not compile")
    finally:
        p.write_text(orig)
    status = "KILLED" if killers else "SURVIVED"
    bad += not killers
    print(f"{status:9} {name}: {len(killers)} failing -> {', '.join(killers[:4])}{' ...' if len(killers) > 4 else ''}")
print("survivors:", bad)
