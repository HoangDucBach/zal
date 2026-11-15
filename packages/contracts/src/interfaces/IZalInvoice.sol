// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Invoice} from "../lib/ZalTypes.sol";

interface IZalInvoice is IERC721 {
    function getInvoice(uint256 id) external view returns (Invoice memory);
    function issueInvoice(uint256 relationshipId, uint128 faceValue, uint64 dueDate, bytes32 docHash)
        external
        returns (uint256 id);
    function approveInvoice(uint256 id) external;
    function rejectInvoice(uint256 id) external;
    function cancelInvoice(uint256 id) external;
    function escrowInvoice(uint256 id) external;
    function payInvoice(uint256 id) external;
}
