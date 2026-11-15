// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

interface IZalFactory {
    function usdc() external view returns (address);
    function registry() external view returns (address);
    function invoices() external view returns (address);
    function pool() external view returns (address);
    function isAccount(address account) external view returns (bool);
    function allowedVault(address vault) external view returns (bool);
}
