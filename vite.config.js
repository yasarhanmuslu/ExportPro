import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        admin: resolve(__dirname, 'admin.html'),
        customers: resolve(__dirname, 'customers.html'),
        orders: resolve(__dirname, 'orders.html'),
        quotations: resolve(__dirname, 'quotations.html'),
        prices: resolve(__dirname, 'prices.html'),
        creditNotes: resolve(__dirname, 'credit-notes.html'),
        orderTimeline: resolve(__dirname, 'order-timeline.html'),
        profitability: resolve(__dirname, 'profitability.html'),
        complaints: resolve(__dirname, 'complaints.html'),
        payments: resolve(__dirname, 'payments.html'),
        shipments: resolve(__dirname, 'shipments.html'),
        customerScore: resolve(__dirname, 'customer-score.html'),
        productAnalysis: resolve(__dirname, 'product-analysis.html'),
        marketAnalysis: resolve(__dirname, 'market-analysis.html'),
        loadingPlanner: resolve(__dirname, 'loading-planner.html'),
        presentation: resolve(__dirname, 'presentation.html'),
      }
    }
  }
});
