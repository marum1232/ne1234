import { Router, type IRouter, type Request, type Response } from "express";
import { adminAuth } from "./admin-shared.js";
import { csrfProtection } from "../middleware/admin-auth.js";
import { db } from "@workspace/db";
import { usersTable, ordersTable, walletTransactionsTable, productsTable } from "@workspace/db/schema";
import { count, and, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import usersRoutes from "./admin/system/users.js";
import rbacRoutes from "./admin/system/rbac.js";
import ordersRoutes from "./admin/orders.js";
import ridesRoutes from "./admin/fleet/rides.js";
import financeRoutes from "./admin/finance/wallets.js";
import contentRoutes from "./admin/content.js";
import systemRoutes from "./admin/system.js";
import serviceZonesRoutes from "./admin/fleet/zones.js";
import deliveryAccessRoutes from "./admin/delivery-access.js";
import conditionsRoutes from "./admin/conditions.js";
import popupsRoutes from "./admin/popups.js";
import supportChatAdminRoutes from "./admin/support-chat.js";
import faqAdminRoutes from "./admin/faq.js";
import communicationAdminRoutes from "./admin/communication.js";
import loyaltyAdminRoutes from "./admin/loyalty.js";
import chatMonitorRoutes from "./admin/chat-monitor.js";
import wishlistAnalyticsRoutes from "./admin/wishlist-analytics.js";
import searchAnalyticsRoutes from "./admin/search-analytics.js";
import qrCodesRoutes from "./admin/qr-codes.js";
import weatherConfigRoutes from "./admin/weather-config.js";
import userAddressesRoutes from "./admin/user-addresses.js";
import experimentsRoutes from "./admin/experiments.js";
import whatsappDeliveryRoutes from "./admin/whatsapp-delivery.js";
import businessRulesRoutes from "./admin/business-rules.js";
import webhookRegistrationsRoutes from "./admin/webhook-registrations.js";
import deepLinksRoutes from "./admin/deep-links.js";
import releaseNotesRoutes from "./admin/release-notes.js";
import launchRoutes, { ensureLaunchData } from "./admin/launch.js";
import otpRoutes from "./admin/otp.js";
import smsGatewaysRoutes from "./admin/sms-gateways.js";
import whitelistRoutes from "./admin/whitelist.js";
import inventorySettingsRoutes from "./admin/inventory-settings.js";
import securityRoutes from "./admin/security.js";
import broadcastsRoutes from "./admin/broadcasts.js";

export {
  DEFAULT_PLATFORM_SETTINGS,
  ensureAuthMethodColumn,
  ensureRideBidsMigration,
  ensureOrdersGpsColumns,
  ensurePromotionsTables,
  ensureSupportMessagesTable,
  ensureFaqsTable,
  ensureCommunicationTables,
  ensureVendorLocationColumns,
  ensureVanServiceUpgrade,
  ensureWalletP2PColumns,
  ensureComplianceTables,
  getPlatformSettings,
  getCachedSettings,
  getAdminSecret,
  adminAuth,
  DEFAULT_RIDE_SERVICES,
  ensureDefaultRideServices,
  ensureDefaultLocations,
  type AdminRequest,
} from "./admin-shared.js";

export { ensureLaunchData };

const router: IRouter = Router();

router.use(adminAuth);
router.use(csrfProtection);

router.use(usersRoutes);
router.use(ordersRoutes);
router.use(ridesRoutes);
router.use(financeRoutes);
router.use(contentRoutes);
router.use(systemRoutes);
// New RBAC management routes (Task #2). Mounted explicitly because the legacy
// systemRoutes monolith above predates the admin/system/* sub-router split.
router.use("/system/rbac", rbacRoutes);
router.use("/service-zones", serviceZonesRoutes);
router.use(deliveryAccessRoutes);
router.use(conditionsRoutes);
router.use(popupsRoutes);
router.use("/support-chat", supportChatAdminRoutes);
router.use("/faqs", faqAdminRoutes);
router.use(communicationAdminRoutes);
router.use(loyaltyAdminRoutes);
router.use("/chat-monitor", chatMonitorRoutes);
router.use(wishlistAnalyticsRoutes);
router.use(searchAnalyticsRoutes);
router.use("/qr-codes", qrCodesRoutes);
router.use("/weather-config", weatherConfigRoutes);
router.use(userAddressesRoutes);
router.use(experimentsRoutes);
router.use("/whatsapp", whatsappDeliveryRoutes);
router.use("/business-rules", businessRulesRoutes);
router.use(webhookRegistrationsRoutes);
router.use(deepLinksRoutes);
router.use(releaseNotesRoutes);
router.use("/launch", launchRoutes);
router.use(otpRoutes);
router.use("/sms-gateways", smsGatewaysRoutes);
router.use("/whitelist", whitelistRoutes);
router.use(inventorySettingsRoutes);
router.use(securityRoutes);
router.use(broadcastsRoutes);

/**
 * GET /api/admin/pending-counts
 * Returns sidebar badge counts for pending riders, orders, withdrawals, and deposits.
 * Protected by the blanket adminAuth middleware above.
 */
router.get("/pending-counts", async (_req: Request, res: Response) => {
  try {
    const [[pendingRiders], [pendingOrders], [pendingWithdrawals], [pendingDeposits], [pendingProducts]] =
      await Promise.all([
        db.select({ count: count() })
          .from(usersTable)
          .where(and(
            eq(usersTable.approvalStatus, "pending"),
            sql`roles LIKE '%rider%'`,
          )),
        db.select({ count: count() })
          .from(ordersTable)
          .where(eq(ordersTable.status, "pending")),
        db.select({ count: count() })
          .from(walletTransactionsTable)
          .where(and(
            eq(walletTransactionsTable.type, "withdrawal"),
            eq(walletTransactionsTable.reference, "pending"),
          )),
        db.select({ count: count() })
          .from(walletTransactionsTable)
          .where(and(
            sql`type IN ('topup', 'deposit')`,
            eq(walletTransactionsTable.reference, "pending"),
          )),
        db.select({ count: count() })
          .from(productsTable)
          .where(and(
            eq(productsTable.approvalStatus, "pending"),
            sql`deleted_at IS NULL`,
          )),
      ]);
    res.json({
      pendingRiders:      Number(pendingRiders?.count      ?? 0),
      pendingOrders:      Number(pendingOrders?.count      ?? 0),
      pendingWithdrawals: Number(pendingWithdrawals?.count  ?? 0),
      pendingDeposits:    Number(pendingDeposits?.count    ?? 0),
      pendingProducts:    Number(pendingProducts?.count    ?? 0),
    });
  } catch (err) {
    logger.warn({ err }, "[pending-counts] query failed");
    res.json({ pendingRiders: 0, pendingOrders: 0, pendingWithdrawals: 0, pendingDeposits: 0, pendingProducts: 0 });
  }
});

export default router;
