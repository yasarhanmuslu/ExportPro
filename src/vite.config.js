import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main:         resolve(__dirname, 'index.html'),
        login:        resolve(__dirname, 'login.html'),
        customers:    resolve(__dirname, 'customers.html'),
        orders:       resolve(__dirname, 'orders.html'),
        prices:       resolve(__dirname, 'prices.html'),
        creditNotes:  resolve(__dirname, 'credit-notes.html'),
        clientPrices: resolve(__dirname, 'client-prices.html'),
      }
    }
  }
});
