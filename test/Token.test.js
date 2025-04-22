const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CryptoSnackToken", function () {
    let TokenFactory;
    let token;
    let owner;
    let addr1;
    let addr2;
    let addr3;
    let addr4;
    let addrs;

    const NAME = "CryptoSnack";
    const SYMBOL = "SNACK";
    const INITIAL_SUPPLY = 1000000;
    const INITIAL_SELLING_TAX = 500; // 5%
    const INITIAL_BUYING_TAX = 300;  // 3%
    const MAX_TAX = 2500;            // 25%
    const TAX_PRECISION = 10000;

    beforeEach(async function () {
        [owner, addr1, addr2, addr3, addr4, ...addrs] = await ethers.getSigners();
        TokenFactory = await ethers.getContractFactory("CryptoSnackToken");
        token = await TokenFactory.deploy(
            NAME,
            SYMBOL,
            INITIAL_SUPPLY,
            INITIAL_SELLING_TAX,
            INITIAL_BUYING_TAX,
            owner.address
        );
    });

    describe("Deployment", function () {
        it("Should set name, symbol, and initial supply correctly", async function () {
            expect(await token.name()).to.equal(NAME);
            expect(await token.symbol()).to.equal(SYMBOL);
            const decimals = await token.decimals();
            const expectedSupply = BigInt(INITIAL_SUPPLY) * (BigInt(10) ** BigInt(decimals));
            expect(await token.totalSupply()).to.equal(expectedSupply);
            expect(await token.balanceOf(owner.address)).to.equal(expectedSupply);
        });

        it("Should set and enable initial tax rates if non-zero", async function () {
            expect(await token.getSellingTax()).to.equal(INITIAL_SELLING_TAX);
            expect(await token.getBuyingTax()).to.equal(INITIAL_BUYING_TAX);
            expect(await token.isTaxEnabled()).to.be.true;
        });

        it("Should revert if selling or buying tax exceeds the max limit", async function () {
            await expect(
                TokenFactory.deploy(
                    NAME,
                    SYMBOL,
                    INITIAL_SUPPLY,
                    MAX_TAX + 1,
                    INITIAL_BUYING_TAX,
                    owner.address
                )
            ).to.be.revertedWithCustomError(token, "TaxTooHigh");

            await expect(
                TokenFactory.deploy(
                    NAME,
                    SYMBOL,
                    INITIAL_SUPPLY,
                    INITIAL_SELLING_TAX,
                    MAX_TAX + 1,
                    owner.address
                )
            ).to.be.revertedWithCustomError(token, "TaxTooHigh");
        });
    });

    describe("Pause/Unpause", function () {
        it("Should allow owner to pause and unpause", async function () {
            await token.pause();
            expect(await token.paused()).to.be.true;
            await token.unpause();
            expect(await token.paused()).to.be.false;
        });

        it("Should revert transfers when paused", async function () {
            await token.pause();
            await expect(token.transfer(addr1.address, ethers.parseEther("10")))
                .to.be.revertedWithCustomError(token, "EnforcedPause");
        });

        it("Should allow certain operations while paused (e.g., setting tax wallet)", async function () {
            await token.pause();
            await expect(token.setTaxWallet(addr1.address)).to.not.be.reverted;
            await expect(token.setDex(addr1.address, true)).to.not.be.reverted;
        });
    });

    describe("Tax Management", function () {
        it("Should allow owner to update tax rates", async function () {
            await token.setSellingTax(1000);
            await token.setBuyingTax(1200);
            expect(await token.getSellingTax()).to.equal(1000);
            expect(await token.getBuyingTax()).to.equal(1200);
        });

        it("Should revert if new tax rates exceed max limit", async function () {
            await expect(token.setSellingTax(MAX_TAX + 1))
                .to.be.revertedWithCustomError(token, "TaxTooHigh");
            await expect(token.setBuyingTax(MAX_TAX + 1))
                .to.be.revertedWithCustomError(token, "TaxTooHigh");
        });

        it("Should allow enabling/disabling taxes", async function () {
            await token.setTaxEnabled(false);
            expect(await token.isTaxEnabled()).to.be.false;
            await token.setTaxEnabled(true);
            expect(await token.isTaxEnabled()).to.be.true;
        });
    });

    describe("DEX Management", function () {
        it("Should allow setting and unsetting DEX addresses", async function () {
            await token.setDex(addr1.address, true);
            expect(await token.isDex(addr1.address)).to.be.true;
            await token.setDex(addr1.address, false);
            expect(await token.isDex(addr1.address)).to.be.false;
        });

        it("Should revert if setting DEX to zero address", async function () {
            await expect(token.setDex(ethers.ZeroAddress, true))
                .to.be.revertedWithCustomError(token, "InvalidDexAddress");
        });

        it("New Test: Should tax both buy and sell if transferring from one DEX to another", async function () {
            await token.setTaxWallet(addr3.address);
            await token.setDex(addr1.address, true);
            await token.setDex(addr2.address, true);

            // Move tokens to addr1 and addr2 first
            const bigAmount = ethers.parseEther("1000");
            await token.transfer(addr1.address, bigAmount);
            await token.transfer(addr2.address, bigAmount);

            // Transfer from addr1 -> addr2
            const txAmount = ethers.parseEther("100");
            const initialTaxWalletBalance = await token.balanceOf(addr3.address);
            await token.connect(addr1).transfer(addr2.address, txAmount);

            // Expected tax (both buy + sell)
            const buyTax = (txAmount * BigInt(INITIAL_BUYING_TAX)) / BigInt(TAX_PRECISION);
            const sellTax = (txAmount * BigInt(INITIAL_SELLING_TAX)) / BigInt(TAX_PRECISION);
            const totalTax = buyTax + sellTax;

            const afterTaxWalletBalance = await token.balanceOf(addr3.address);
            expect(afterTaxWalletBalance - initialTaxWalletBalance).to.equal(totalTax);
        });
    });

    describe("Whitelist & Blacklist", function () {
        it("Should allow owner to whitelist and blacklist accounts", async function () {
            await token.setWhitelist(addr1.address, true);
            expect(await token.isWhitelisted(addr1.address)).to.be.true;

            await token.setBlacklist(addr2.address, true);
            expect(await token.isBlacklisted(addr2.address)).to.be.true;
        });

        it("Should revert if trying to blacklist a whitelisted account", async function () {
            await token.setWhitelist(addr1.address, true);
            await expect(token.setBlacklist(addr1.address, true))
                .to.be.revertedWithCustomError(token, "AccountIsWhitelisted");
        });

        it("Should revert if trying to whitelist a blacklisted account", async function () {
            await token.setBlacklist(addr1.address, true);
            await expect(token.setWhitelist(addr1.address, true))
                .to.be.revertedWithCustomError(token, "AccountIsBlacklisted");
        });

        it("Should revert transfers to or from blacklisted account", async function () {
            await token.transfer(addr1.address, ethers.parseEther("100"));
            await token.setBlacklist(addr1.address, true);
            await expect(token.connect(addr1).transfer(addr2.address, 1))
                .to.be.revertedWithCustomError(token, "BlacklistedAccount");
            await expect(token.transfer(addr1.address, 1))
                .to.be.revertedWithCustomError(token, "BlacklistedAccount");
        });
    });

    describe("Tax Wallet", function () {
        it("Should allow owner to set a valid tax wallet", async function () {
            await token.setTaxWallet(addr1.address);
            expect(await token.getTaxWallet()).to.equal(addr1.address);
        });

        it("Should revert if tax wallet is zero address", async function () {
            await expect(token.setTaxWallet(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(token, "InvalidTaxWallet");
        });

        it("Should emit TaxWalletUpdated event on each change", async function () {
            await expect(token.setTaxWallet(addr1.address))
                .to.emit(token, "TaxWalletUpdated")
                .withArgs(ethers.ZeroAddress, addr1.address);
            await expect(token.setTaxWallet(addr2.address))
                .to.emit(token, "TaxWalletUpdated")
                .withArgs(addr1.address, addr2.address);
        });
    });

    describe("Transfer Mechanics", function () {
        beforeEach(async function () {
            await token.setDex(addr2.address, true);
            await token.setTaxWallet(addr3.address);
            // Move some tokens to addr1, addr2 for testing
            await token.transfer(addr1.address, ethers.parseEther("500"));
            await token.transfer(addr2.address, ethers.parseEther("500"));
        });

        it("Should charge buying tax if receiving from DEX", async function () {
            const transferAmount = ethers.parseEther("100");
            const initialBalanceAddr1 = await token.balanceOf(addr1.address);
            const initialBalanceTaxWallet = await token.balanceOf(addr3.address);

            await token.connect(addr2).transfer(addr1.address, transferAmount);

            const tax = (transferAmount * BigInt(INITIAL_BUYING_TAX)) / BigInt(TAX_PRECISION);
            expect((await token.balanceOf(addr3.address)) - initialBalanceTaxWallet).to.equal(tax);
            expect((await token.balanceOf(addr1.address)) - initialBalanceAddr1).to.equal(transferAmount - tax);
        });

        it("Should charge selling tax if sending to DEX", async function () {
            const transferAmount = ethers.parseEther("100");
            const initialBalanceAddr2 = await token.balanceOf(addr2.address);
            const initialBalanceTaxWallet = await token.balanceOf(addr3.address);

            await token.connect(addr1).transfer(addr2.address, transferAmount);

            const tax = (transferAmount * BigInt(INITIAL_SELLING_TAX)) / BigInt(TAX_PRECISION);
            expect((await token.balanceOf(addr3.address)) - initialBalanceTaxWallet).to.equal(tax);
            expect((await token.balanceOf(addr2.address)) - initialBalanceAddr2).to.equal(transferAmount - tax);
        });

        it("Should skip tax for whitelisted addresses or when tax is disabled", async function () {
            await token.setWhitelist(addr1.address, true);

            const transferAmount = ethers.parseEther("50");
            const oldBalance2 = await token.balanceOf(addr2.address);
            await token.connect(addr1).transfer(addr2.address, transferAmount);
            expect(await token.balanceOf(addr2.address)).to.equal(oldBalance2 + transferAmount);

            // Disable tax and transfer from non-whitelisted
            await token.setTaxEnabled(false);
            const oldBalance1 = await token.balanceOf(addr1.address);
            await token.connect(addr2).transfer(addr1.address, transferAmount);
            expect(await token.balanceOf(addr1.address)).to.equal(oldBalance1 + transferAmount);
        });

        it("Should revert taxed transfer if tax wallet is not set", async function () {
            // Deploy a fresh token with no tax wallet
            const tokenNoWallet = await TokenFactory.deploy(
                NAME,
                SYMBOL,
                INITIAL_SUPPLY,
                INITIAL_SELLING_TAX,
                INITIAL_BUYING_TAX,
                owner.address
            );

            await tokenNoWallet.setDex(addr2.address, true);
            await tokenNoWallet.transfer(addr1.address, ethers.parseEther("1000"));
            await tokenNoWallet.setTaxEnabled(true);

            await expect(tokenNoWallet.connect(addr1).transfer(addr2.address, ethers.parseEther("100")))
                .to.be.revertedWithCustomError(tokenNoWallet, "InvalidTaxWallet");
        });

        it("Should handle zero amount transfer gracefully", async function () {
            await expect(token.connect(addr1).transfer(addr2.address, 0)).to.not.be.reverted;
        });

        it("Should revert if sender does not have enough balance", async function () {
            const balance = await token.balanceOf(addr1.address);
            await expect(
                token.connect(addr1).transfer(addr2.address, balance + BigInt(1))
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });
    });

    describe("Multi-Transfer", function () {
        beforeEach(async function () {
            // Give owner a big chunk for batch testing
            await token.transfer(owner.address, ethers.parseEther("1000000"));
        });

        it("Should transfer different amounts with multiTransfer", async function () {
            const recipients = [addr1.address, addr2.address, addr3.address];
            const amounts = [100, 200, 300].map(v => ethers.parseEther(v.toString()));

            await token.multiTransfer(recipients, amounts);

            expect(await token.balanceOf(addr1.address)).to.equal(amounts[0]);
            expect(await token.balanceOf(addr2.address)).to.equal(amounts[1]);
            expect(await token.balanceOf(addr3.address)).to.equal(amounts[2]);
        });

        it("Should revert if array lengths mismatch or exceed batch size", async function () {
            await expect(token.multiTransfer([addr1.address], []))
                .to.be.revertedWithCustomError(token, "ArraysLengthMismatch");

            const bigList = new Array(201).fill(addr1.address);
            const bigAmounts = new Array(201).fill(ethers.parseEther("100"));
            await expect(token.multiTransfer(bigList, bigAmounts))
                .to.be.revertedWithCustomError(token, "InvalidBatchLength");
        });

        it("Should quietly skip blacklisted recipients rather than reverting", async function () {
            await token.setBlacklist(addr3.address, true);
            const recipients = [addr1.address, addr2.address, addr3.address];
            const amounts = [100, 100, 100].map(v => ethers.parseEther(v.toString()));

            const balBefore3 = await token.balanceOf(addr3.address);
            await token.multiTransfer(recipients, amounts);

            // Blacklisted (addr3) gets skipped.
            expect(await token.balanceOf(addr3.address)).to.equal(balBefore3);
        });

        it("Should transfer equal amounts with multiTransferEqual", async function () {
            const recipients = [addr1.address, addr2.address, addr3.address];
            const amountEach = ethers.parseEther("500");

            await token.multiTransferEqual(recipients, amountEach);

            for (const r of recipients) {
                expect(await token.balanceOf(r)).to.equal(amountEach);
            }
        });
    });

    describe("Account Freezing & Recovery", function () {
        beforeEach(async function () {
            await token.transfer(addr1.address, ethers.parseEther("100"));
        });

        it("Should allow owner to freeze and unfreeze after expiry", async function () {
            await token.freezeAccount(addr1.address);
            expect(await token.isFrozen(addr1.address)).to.be.true;

            await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine");

            expect(await token.isFrozen(addr1.address)).to.be.false;
        });

        it("Should revert transfers from or to frozen account", async function () {
            await token.freezeAccount(addr1.address);
            await expect(token.connect(addr1).transfer(addr2.address, 10))
                .to.be.revertedWithCustomError(token, "FrozenAccount");
        });

        it("Should revert if freezing an already frozen account", async function () {
            await token.freezeAccount(addr1.address);
            await expect(token.freezeAccount(addr1.address))
                .to.be.revertedWithCustomError(token, "AccountAlreadyFrozen");
        });

        it("Should allow recovering tokens from frozen account and then unfreeze", async function () {
            await token.freezeAccount(addr1.address);

            const amountToRecover = ethers.parseEther("50");
            await token.recoverStolenTokens(addr1.address, addr2.address, amountToRecover);

            expect(await token.balanceOf(addr2.address)).to.equal(amountToRecover);
            expect(await token.isFrozen(addr1.address)).to.be.false;
        });

        it("Should revert recovery if account is not frozen", async function () {
            await expect(
                token.recoverStolenTokens(addr1.address, addr2.address, ethers.parseEther("10"))
            ).to.be.revertedWithCustomError(token, "AccountNotFrozen");
        });
    });

    describe("Ownership Transfer", function () {
        it("Should let owner transfer ownership", async function () {
            await token.transferOwnership(addr1.address);
            expect(await token.owner()).to.equal(addr1.address);
        });

        it("Should block old owner from privileged functions after ownership transfer", async function () {
            await token.transferOwnership(addr1.address);
            await expect(token.setBurnEnabled(true))
                .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
        });

        it("New Test: Should allow new owner to assume all privileges", async function () {
            await token.transferOwnership(addr1.address);
            await token.connect(addr1).setBurnEnabled(true);
        });
    });

    describe("Burn Functionality", function () {
        beforeEach(async function () {
            await token.transfer(addr1.address, ethers.parseEther("1000"));
        });

        it("Should allow owner to burn even if burn is disabled", async function () {
            const burnAmount = ethers.parseEther("50");
            const totalSupplyBefore = await token.totalSupply();
            await token.burn(burnAmount);
            expect(await token.totalSupply()).to.equal(totalSupplyBefore - burnAmount);
        });

        it("Should revert if non-owner tries to burn while burn is disabled", async function () {
            await expect(token.connect(addr1).burn(100))
                .to.be.revertedWithCustomError(token, "BurnDisallowed");
        });

        it("Should allow anyone to burn when burn is enabled", async function () {
            await token.setBurnEnabled(true);
            const burnAmount = ethers.parseEther("20");
            const initialTotalSupply = await token.totalSupply();
            const initialAddr1Balance = await token.balanceOf(addr1.address);

            await token.connect(addr1).burn(burnAmount);
            expect(await token.totalSupply()).to.equal(initialTotalSupply - burnAmount);
            expect(await token.balanceOf(addr1.address)).to.equal(initialAddr1Balance - burnAmount);
        });

        describe("burnFrom", function () {
            const approveAmount = ethers.parseEther("200");
            const burnAmount = ethers.parseEther("50");

            beforeEach(async function () {
                await token.connect(addr1).approve(owner.address, approveAmount);
                await token.connect(addr1).approve(addr2.address, approveAmount);
            });

            it("Should allow owner to burnFrom when burn is disabled", async function () {
                const totalSupplyBefore = await token.totalSupply();
                await token.burnFrom(addr1.address, burnAmount);
                expect(await token.totalSupply()).to.equal(totalSupplyBefore - burnAmount);
            });

            it("Should revert if approval is insufficient", async function () {
                await expect(token.burnFrom(addr1.address, approveAmount + BigInt(1)))
                    .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
            });

            it("Should allow approved address to burnFrom when burn is enabled", async function () {
                await token.setBurnEnabled(true);
                const totalSupplyBefore = await token.totalSupply();
                await token.connect(addr2).burnFrom(addr1.address, burnAmount);
                expect(await token.totalSupply()).to.equal(totalSupplyBefore - burnAmount);
            });
        });
    });

    describe("Token & BNB Recovery", function () {
        it("Should allow owner to reclaim BNB", async function () {
            // Send some ETH to the contract
            const sendTx = {
                to: token.target,
                value: ethers.parseEther("1")
            };
            await owner.sendTransaction(sendTx);

            let contractBalance = await ethers.provider.getBalance(token.target);
            expect(contractBalance).to.be.gt(0);

            const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
            await token.reclaimBNB();

            // Check that contract balance is zero (or near zero)
            contractBalance = await ethers.provider.getBalance(token.target);
            expect(contractBalance).to.equal(0);

            // Check that owner's balance increased
            const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
            expect(ownerBalanceAfter).to.be.gt(ownerBalanceBefore);
        });

        it("Should allow owner to reclaim other ERC20 tokens", async function () {
            const testFactory = await ethers.getContractFactory("CryptoSnackToken");
            const testToken = await testFactory.deploy(
                "Test",
                "TST",
                10000,
                0,
                0,
                owner.address
            );
            // Transfer some TST to the main token contract
            const amount = ethers.parseEther("100");
            await testToken.transfer(token.target, amount);

            // Reclaim them
            const ownerBalanceBefore = await testToken.balanceOf(owner.address);
            await token.reclaimToken(testToken.target);
            const ownerBalanceAfter = await testToken.balanceOf(owner.address);
            expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(amount);
        });
    });
});
