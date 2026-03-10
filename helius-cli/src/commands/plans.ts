import chalk from "chalk";
import { PLAN_CATALOG } from "../lib/checkout.js";
import { outputJson, type OutputOptions } from "../lib/output.js";

interface PlansOptions extends OutputOptions {}

export function plansCommand(options: PlansOptions = {}): void {
  // The "basic" plan in signup is the Agent tier ($1 one-time signup fee)
  const plans = [
    {
      key: "basic",
      name: "Agent",
      monthlyPrice: 0,
      yearlyPrice: 0,
      signupFee: 1,
      credits: 1_000_000,
      requestsPerSecond: 10,
    },
    ...Object.entries(PLAN_CATALOG).map(([key, plan]) => ({
      key,
      ...plan,
    })),
  ];

  if (options.json) {
    outputJson([
      ...plans.map((p) => ({
        plan: p.key,
        name: p.name,
        credits: p.credits,
        requestsPerSecond: p.requestsPerSecond,
        ...("signupFee" in p
          ? { signupFee: p.signupFee, monthlyPrice: 0, yearlyPrice: 0 }
          : { monthlyPrice: p.monthlyPrice / 100, yearlyPrice: p.yearlyPrice / 100 }),
      })),
      { plan: "enterprise", name: "Enterprise", credits: null, requestsPerSecond: null, monthlyPrice: null, yearlyPrice: null },
    ]);
    return;
  }

  console.log(chalk.bold("\nHelius Plans\n"));

  for (const plan of plans) {
    const credits = plan.credits.toLocaleString();
    const rps = plan.requestsPerSecond;

    let priceLabel: string;
    if ("signupFee" in plan) {
      priceLabel = `$${plan.signupFee} one-time signup`;
    } else {
      priceLabel = `$${plan.monthlyPrice / 100}/mo / $${(plan.yearlyPrice / 100).toLocaleString()}/yr`;
    }

    console.log(`  ${chalk.cyan(plan.name)}`);
    console.log(`    ${chalk.gray("Price:")}   ${priceLabel}`);
    console.log(`    ${chalk.gray("Credits:")} ${credits}/month`);
    console.log(`    ${chalk.gray("Rate:")}    ${rps} req/s`);
    console.log();
  }

  console.log(`  ${chalk.cyan("Enterprise")}`);
  console.log(`    ${chalk.gray("Price:")}   Custom`);
  console.log(`    ${chalk.gray("Credits:")} Custom`);
  console.log(`    ${chalk.gray("Rate:")}    Custom`);
  console.log();

  console.log(chalk.gray("  Sign up: helius signup [--plan <plan>] [--period monthly|yearly]"));
  console.log(chalk.gray("  Upgrade: helius upgrade --plan <plan> [--period monthly|yearly]"));
  console.log(chalk.gray("  Enterprise: https://www.helius.dev/docs/billing/plans#enterprise-plans\n"));
}
