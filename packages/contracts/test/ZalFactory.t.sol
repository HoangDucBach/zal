// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Errors} from "@openzeppelin/contracts/utils/Errors.sol";
import {CanvasAccount} from "../src/CanvasAccount.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {RelationshipRegistry} from "../src/RelationshipRegistry.sol";
import {ZalFactory} from "../src/ZalFactory.sol";
import {ZalVault} from "../src/ZalVault.sol";
import {IZalFactory} from "../src/interfaces/IZalFactory.sol";
import {MemberRole} from "../src/lib/ZalTypes.sol";
import {ZalTestBase} from "./support/ZalTestBase.sol";

contract ZalFactoryTest is ZalTestBase {
    function test_wireRunsOnce() public {
        vm.expectRevert(ZalFactory.AlreadyWired.selector);
        vm.prank(owner);
        factory.wire(address(usdc), address(registry), address(invoices), address(pool));
    }

    function test_wireOnlyOwner() public {
        ZalFactory fresh = new ZalFactory(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        fresh.wire(address(usdc), address(registry), address(invoices), address(pool));
    }

    function test_wireRejectsContractsBuiltForAnotherFactory() public {
        ZalFactory fresh = new ZalFactory(owner);
        vm.expectRevert(ZalFactory.WiringMismatch.selector);
        vm.prank(owner);
        fresh.wire(address(usdc), address(registry), address(invoices), address(pool));

        RelationshipRegistry freshRegistry = new RelationshipRegistry(IZalFactory(address(fresh)));
        vm.expectRevert(ZalFactory.WiringMismatch.selector);
        vm.prank(owner);
        fresh.wire(address(usdc), address(freshRegistry), address(invoices), address(pool));
    }

    function test_createAccountNeedsWiring() public {
        ZalFactory fresh = new ZalFactory(owner);
        vm.expectRevert(ZalFactory.NotWired.selector);
        fresh.createAccount(d, bytes32(0));
    }

    function test_createAccountIsPredictableAndRegistered() public {
        bytes32 salt = keccak256("club");
        address predicted = factory.predictAccount(stranger, salt);
        assertFalse(factory.isAccount(predicted));
        address account = factory.createAccount(stranger, salt);

        assertEq(account, predicted);
        assertTrue(factory.isAccount(account));
        assertEq(uint8(CanvasAccount(account).roleOf(stranger)), uint8(MemberRole.Admin));
        assertEq(address(CanvasAccount(account).usdc()), address(usdc));
        assertEq(address(CanvasAccount(account).invoices()), address(invoices));
        assertEq(CanvasAccount(account).pool(), address(pool));
    }

    function test_saltIsBoundToAdmin() public {
        bytes32 salt = keccak256("club");
        address forStranger = factory.predictAccount(stranger, salt);
        address forOther = factory.createAccount(lp, salt);
        assertTrue(forOther != forStranger, "another admin cannot take the predicted address");
        assertEq(factory.createAccount(stranger, salt), forStranger);

        vm.expectRevert(Errors.FailedDeployment.selector);
        factory.createAccount(stranger, salt);
    }

    function test_initializeRunsOnceAndOnlyFromFactory() public {
        vm.expectRevert(CanvasAccount.NotFactory.selector);
        vm.prank(stranger);
        D.initialize(stranger);
        vm.expectRevert(CanvasAccount.AlreadyInitialized.selector);
        vm.prank(address(factory));
        D.initialize(stranger);

        CanvasAccount implementation = CanvasAccount(factory.accountImplementation());
        vm.expectRevert(CanvasAccount.NotFactory.selector);
        vm.prank(stranger);
        implementation.initialize(stranger);
        assertFalse(factory.isAccount(address(implementation)));
    }

    function test_cloneOfImplementationMadeElsewhereIsNotAnAccount() public {
        address rogue = Clones.clone(factory.accountImplementation());
        assertFalse(factory.isAccount(rogue));
        vm.expectRevert(CanvasAccount.NotFactory.selector);
        CanvasAccount(rogue).initialize(stranger);
    }

    function test_createAccountRejectsZeroAdmin() public {
        vm.expectRevert(CanvasAccount.ZeroAddress.selector);
        factory.createAccount(address(0), bytes32(0));
    }

    function test_setAllowedVault() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        factory.setAllowedVault(address(vault), false);

        ZalVault wrongAsset = new ZalVault(IERC20(address(new MockUSDC())), owner, keeper);
        vm.startPrank(owner);
        vm.expectRevert(ZalFactory.VaultAssetMismatch.selector);
        factory.setAllowedVault(address(wrongAsset), true);
        factory.setAllowedVault(address(vault), false);
        vm.stopPrank();
        assertFalse(factory.allowedVault(address(vault)));
    }
}
