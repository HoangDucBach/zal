// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {MemberRole} from "../lib/ZalTypes.sol";

interface ICanvasAccount {
    function initialize(address admin) external;
    function roleOf(address member) external view returns (MemberRole);
    function receivePayment(uint256 invoiceId, uint256 amount) external;
}
