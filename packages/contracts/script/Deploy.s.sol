// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Script} from "forge-std/Script.sol";
import {stdToml} from "forge-std/StdToml.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ZUSDC} from "../src/ZUSDC.sol";
import {RelationshipRegistry} from "../src/RelationshipRegistry.sol";
import {ZalFactory} from "../src/ZalFactory.sol";
import {ZalFundingPool} from "../src/ZalFundingPool.sol";
import {ZalInvoice} from "../src/ZalInvoice.sol";
import {ZalVault} from "../src/ZalVault.sol";
import {IZalFactory} from "../src/interfaces/IZalFactory.sol";
import {IZalInvoice} from "../src/interfaces/IZalInvoice.sol";

/// @dev Deploys and wires the whole protocol. `ZAL_NETWORK` (default `local`) picks `script/config/<network>.toml`
/// and writes `deployments/<network>.json`. Broadcast with the owner key from that config:
/// ZAL_NETWORK=l1 forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast --account <keystore>
contract Deploy is Script {
    using stdToml for string;

    string internal cfg;
    string internal out;
    address internal owner;
    address internal keeper;
    ZUSDC internal usdc;
    ZalFactory internal factory;
    RelationshipRegistry internal registry;
    ZalInvoice internal invoices;
    ZalFundingPool internal pool;
    ZalVault internal vault;

    function run() external {
        string memory network = vm.envOr("ZAL_NETWORK", string("local"));
        string memory config = string.concat("script/config/", network, ".toml");
        out = string.concat("deployments/", network, ".json");
        cfg = vm.readFile(config);
        require(block.chainid == cfg.readUint(".chain.id"), "wrong chain for this config");
        owner = cfg.readAddress(".roles.owner");
        keeper = cfg.readAddress(".roles.keeper");

        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        require(sender == owner, "broadcast with the owner key");

        usdc = new ZUSDC();
        factory = new ZalFactory(owner);
        registry = new RelationshipRegistry(IZalFactory(address(factory)));
        invoices = new ZalInvoice(IZalFactory(address(factory)), IERC20(address(usdc)));
        pool = new ZalFundingPool(
            IERC20(address(usdc)),
            IZalInvoice(address(invoices)),
            owner,
            SafeCast.toUint16(cfg.readUint(".pool.advance_rate_bps")),
            SafeCast.toUint16(cfg.readUint(".pool.annual_fee_bps"))
        );
        vault = new ZalVault(IERC20(address(usdc)), owner, keeper);
        factory.wire(address(usdc), address(registry), address(invoices), address(pool));
        factory.setAllowedVault(address(vault), true);
        vm.stopBroadcast();

        _writeDeployment();
    }

    function _writeDeployment() internal {
        string memory json = "local";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "owner", owner);
        vm.serializeAddress(json, "keeper", keeper);
        vm.serializeAddress(json, "usdc", address(usdc));
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "accountImplementation", factory.accountImplementation());
        vm.serializeAddress(json, "registry", address(registry));
        vm.serializeAddress(json, "invoices", address(invoices));
        vm.serializeAddress(json, "pool", address(pool));
        vm.serializeAddress(json, "vault", address(vault));
        vm.serializeUint(json, "advanceRateBps", pool.advanceRateBps());
        vm.serializeUint(json, "annualFeeBps", pool.annualFeeBps());
        string memory finalJson =
            vm.serializeUint(json, "vaultSimulatedApyBps", cfg.readUint(".vault.simulated_apy_bps"));
        vm.writeJson(finalJson, out);
    }
}
