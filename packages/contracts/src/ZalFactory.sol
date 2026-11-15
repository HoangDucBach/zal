// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {CanvasAccount} from "./CanvasAccount.sol";
import {IZalFactory} from "./interfaces/IZalFactory.sol";

interface IWired {
    function factory() external view returns (address);
    function invoices() external view returns (address);
    function usdc() external view returns (address);
}

/// @dev Deploys CanvasAccount clones and holds the protocol wiring. Clones are not upgradeable.
contract ZalFactory is IZalFactory, Ownable {
    address public immutable accountImplementation;

    address public usdc;
    address public registry;
    address public invoices;
    address public pool;
    mapping(address account => bool) public isAccount;
    mapping(address vault => bool) public allowedVault;

    event Wired(address usdc, address registry, address invoices, address pool);
    event AccountCreated(address indexed account, address indexed admin, bytes32 salt);
    event AllowedVaultSet(address indexed vault, bool allowed);

    error AlreadyWired();
    error NotWired();
    error ZeroAddress();
    error WiringMismatch();
    error VaultAssetMismatch();

    constructor(address owner_) Ownable(owner_) {
        accountImplementation = address(new CanvasAccount());
    }

    /// @dev ZR-SYS-01. Runs once. The registry and the invoice contract take this factory in their constructors
    /// and the pool takes the invoice contract, so this call closes the deploy cycle. Each address is checked
    /// against the others, because a wrong one could never be corrected.
    // forge-lint: disable-next-line(missing-zero-check)
    function wire(address usdc_, address registry_, address invoices_, address pool_) external onlyOwner {
        if (usdc != address(0)) revert AlreadyWired();
        if (usdc_ == address(0)) revert ZeroAddress();
        if (
            IWired(registry_).factory() != address(this) || IWired(invoices_).factory() != address(this)
                || IWired(invoices_).usdc() != usdc_ || IWired(pool_).invoices() != invoices_
                || IERC4626(pool_).asset() != usdc_
        ) revert WiringMismatch();
        usdc = usdc_;
        registry = registry_;
        invoices = invoices_;
        pool = pool_;
        emit Wired(usdc_, registry_, invoices_, pool_);
    }

    /// @dev Open to anyone. The clone salt binds `admin`, so nobody can take an address predicted for another
    /// admin.
    function createAccount(address admin, bytes32 salt) external returns (address account) {
        if (usdc == address(0)) revert NotWired();
        account = Clones.cloneDeterministic(accountImplementation, _salt(admin, salt));
        isAccount[account] = true;
        CanvasAccount(account).initialize(admin);
        emit AccountCreated(account, admin, salt);
    }

    function predictAccount(address admin, bytes32 salt) external view returns (address) {
        return Clones.predictDeterministicAddress(accountImplementation, _salt(admin, salt));
    }

    function setAllowedVault(address vault, bool allowed) external onlyOwner {
        if (allowed && IERC4626(vault).asset() != usdc) revert VaultAssetMismatch();
        allowedVault[vault] = allowed;
        emit AllowedVaultSet(vault, allowed);
    }

    function _salt(address admin, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(admin, salt));
    }
}
