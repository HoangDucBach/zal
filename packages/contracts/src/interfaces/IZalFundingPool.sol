// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

interface IZalFundingPool {
    function advance(uint256 invoiceId) external;
    function onRepaid(uint256 invoiceId, uint256 amount) external;
}
