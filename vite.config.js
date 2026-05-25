import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        customers: resolve(__dirname, 'customers.html'),
        orders: resolve(__dirname, 'orders.html'),
        prices: resolve(__dirname, 'prices.html'),
        creditNotes: resolve(__dirname, 'credit-notes.html'),
        orderTimeline: resolve(__dirname, 'order-timeline.html'),
        profitability: resolve(__dirname, 'profitability.html'),
        complaints: resolve(__dirname, 'complaints.html'),
        payments: resolve(__dirname, 'payments.html'),
        shipments: resolve(__dirname, 'shipments.html')
      }
    }
  }
});