// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {CanvasAccount} from "../src/CanvasAccount.sol";
import {RelationshipRegistry} from "../src/RelationshipRegistry.sol";
import {Invite, MemberRole, Relationship, RelStatus, Role} from "../src/lib/ZalTypes.sol";
import {ZalTestBase} from "./support/ZalTestBase.sol";

contract RelationshipRegistryTest is ZalTestBase {
    function _status(uint256 id) internal view returns (RelStatus) {
        return registry.getRelationship(id).status;
    }

    function _invite(uint256 nonce) internal view returns (Invite memory) {
        return Invite({
            proposer: address(D),
            proposerRole: Role.Seller,
            inviteeEmailHash: keccak256("club@example.org"),
            nonce: nonce,
            deadline: uint64(block.timestamp + 7 days)
        });
    }

    function _proposeDemo(uint64 expiresAt) internal returns (uint256 id) {
        vm.prank(d);
        id = D.proposeRelationship(address(C), Role.Seller, expiresAt);
    }

    // ---- Acceptance tests

    function test_AT02_proposeAndAccept() public {
        uint256 id = _proposeDemo(0);
        vm.prank(c1);
        C.acceptRelationship(id);

        Relationship memory rel = registry.getRelationship(id);
        assertEq(uint8(rel.status), uint8(RelStatus.Active));
        assertEq(rel.buyer, address(C));
        assertEq(rel.seller, address(D));
        assertEq(rel.proposer, address(D));

        vm.expectRevert(abi.encodeWithSelector(RelationshipRegistry.RelationshipExists.selector, id));
        vm.prank(d);
        D.proposeRelationship(address(C), Role.Seller, 0);
        vm.expectRevert(abi.encodeWithSelector(RelationshipRegistry.RelationshipExists.selector, id));
        vm.prank(c1);
        C.proposeRelationship(address(D), Role.Buyer, 0);
    }

    function test_AT03_onlyTheNonProposerDecides() public {
        uint256 first = _proposeDemo(0);
        vm.expectRevert(RelationshipRegistry.NotCounterparty.selector);
        vm.prank(d);
        D.acceptRelationship(first);

        vm.prank(c1);
        C.rejectRelationship(first);
        assertEq(uint8(_status(first)), uint8(RelStatus.Rejected));

        vm.expectRevert(abi.encodeWithSelector(RelationshipRegistry.NotProposed.selector, first));
        vm.prank(c1);
        C.acceptRelationship(first);

        uint256 second = _proposeDemo(0);
        assertEq(uint8(_status(second)), uint8(RelStatus.Proposed), "a rejected pair can be proposed again");
    }

    function test_AT04_inviteRedeemedOnce() public {
        Invite memory invite = _invite(1);
        bytes memory sig = _signInvite(dKey, invite);

        vm.prank(c1);
        uint256 id = C.acceptInvite(invite, sig);
        Relationship memory rel = registry.getRelationship(id);
        assertEq(uint8(rel.status), uint8(RelStatus.Active));
        assertEq(rel.buyer, address(C));
        assertEq(rel.seller, address(D));

        CanvasAccount other = _newAccount(stranger);
        vm.expectRevert(RelationshipRegistry.InviteNonceUsed.selector);
        vm.prank(stranger);
        other.acceptInvite(invite, sig);
    }

    // ---- Proposals

    function test_partiesMustBeDistinctAccounts() public {
        vm.startPrank(d);
        vm.expectRevert(abi.encodeWithSelector(RelationshipRegistry.NotAccount.selector, stranger));
        D.proposeRelationship(stranger, Role.Seller, 0);
        vm.expectRevert(RelationshipRegistry.SelfRelationship.selector);
        D.proposeRelationship(address(D), Role.Seller, 0);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(RelationshipRegistry.NotAccount.selector, stranger));
        vm.prank(stranger);
        registry.propose(address(D), Role.Buyer, 0);
    }

    function test_oppositeDirectionIsASeparateRelationship() public {
        uint256 first = _relateDemo();
        uint256 second = _relate(D, d, C, c1);
        assertTrue(first != second);
        assertEq(registry.liveRelationship(address(D), address(C)), second);
    }

    function test_proposerCancels() public {
        uint256 id = _proposeDemo(0);
        vm.expectRevert(RelationshipRegistry.NotProposer.selector);
        vm.prank(c1);
        C.cancelRelationship(id);

        vm.prank(d);
        D.cancelRelationship(id);
        assertEq(uint8(_status(id)), uint8(RelStatus.Cancelled));
        assertEq(registry.liveRelationship(address(C), address(D)), 0);
    }

    function test_expiredProposalCannotBeAcceptedOrRejected() public {
        uint256 id = _proposeDemo(uint64(block.timestamp + 1 days));
        vm.warp(block.timestamp + 1 days);
        vm.startPrank(c1);
        vm.expectRevert(abi.encodeWithSelector(RelationshipRegistry.ProposalExpired.selector, id));
        C.acceptRelationship(id);
        vm.expectRevert(abi.encodeWithSelector(RelationshipRegistry.ProposalExpired.selector, id));
        C.rejectRelationship(id);
        vm.stopPrank();
    }

    function test_expiredProposalIsReplacedByANewOne() public {
        uint256 old = _proposeDemo(uint64(block.timestamp + 1 days));
        vm.warp(block.timestamp + 1 days);
        vm.prank(c1);
        uint256 fresh = C.proposeRelationship(address(D), Role.Buyer, 0);

        assertEq(uint8(_status(old)), uint8(RelStatus.Cancelled));
        assertEq(registry.liveRelationship(address(C), address(D)), fresh);
        vm.expectRevert(abi.encodeWithSelector(RelationshipRegistry.NotProposed.selector, old));
        vm.prank(d);
        D.cancelRelationship(old);
    }

    function test_expiryMustBeInTheFuture() public {
        vm.expectRevert(RelationshipRegistry.ExpiryInPast.selector);
        vm.prank(d);
        D.proposeRelationship(address(C), Role.Seller, uint64(block.timestamp));
    }

    function test_relationshipActionsNeedAdmin() public {
        vm.expectRevert(CanvasAccount.NotAdmin.selector);
        vm.prank(c2);
        C.proposeRelationship(address(D), Role.Buyer, 0);
    }

    // ---- Invites

    function test_inviteSignerMustBeAdminOfProposer() public {
        Invite memory invite = _invite(1);
        (address mallory, uint256 malloryKey) = makeAddrAndKey("mallory");
        bytes memory sig = _signInvite(malloryKey, invite);
        vm.expectRevert(abi.encodeWithSelector(RelationshipRegistry.InviteSignerNotAdmin.selector, mallory));
        vm.prank(c1);
        C.acceptInvite(invite, sig);

        vm.prank(d);
        D.setMember(mallory, MemberRole.Approver);
        vm.expectRevert(abi.encodeWithSelector(RelationshipRegistry.InviteSignerNotAdmin.selector, mallory));
        vm.prank(c1);
        C.acceptInvite(invite, sig);
    }

    function test_inviteFromRemovedAdminIsVoid() public {
        Invite memory invite = _invite(1);
        bytes memory sig = _signInvite(dKey, invite);
        vm.startPrank(d);
        D.setMember(stranger, MemberRole.Admin);
        D.setMember(d, MemberRole.None);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(RelationshipRegistry.InviteSignerNotAdmin.selector, d));
        vm.prank(c1);
        C.acceptInvite(invite, sig);
    }

    function test_inviteDeadline() public {
        Invite memory invite = _invite(1);
        bytes memory sig = _signInvite(dKey, invite);
        vm.warp(invite.deadline + 1);
        vm.expectRevert(RelationshipRegistry.InviteExpired.selector);
        vm.prank(c1);
        C.acceptInvite(invite, sig);
    }

    function test_tamperedInviteFails() public {
        Invite memory invite = _invite(1);
        bytes memory sig = _signInvite(dKey, invite);
        invite.proposerRole = Role.Buyer;
        vm.expectRevert();
        vm.prank(c1);
        C.acceptInvite(invite, sig);
    }

    function test_inviteCannotDuplicateALiveRelationship() public {
        uint256 id = _relateDemo();
        Invite memory invite = _invite(1);
        bytes memory sig = _signInvite(dKey, invite);
        vm.expectRevert(abi.encodeWithSelector(RelationshipRegistry.RelationshipExists.selector, id));
        vm.prank(c1);
        C.acceptInvite(invite, sig);
    }

    function test_inviteCallerMustBeAnAccount() public {
        Invite memory invite = _invite(1);
        bytes memory sig = _signInvite(dKey, invite);
        vm.expectRevert(abi.encodeWithSelector(RelationshipRegistry.NotAccount.selector, stranger));
        vm.prank(stranger);
        registry.acceptInvite(invite, sig);
    }
}
