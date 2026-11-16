import type { RouteObject } from "react-router";
import { BillDetailPage } from "./BillDetailPage";
import { BillsPage } from "./BillsPage";
import { NewBillPage } from "./NewBillPage";
import { NewVendorPage } from "./NewVendorPage";
import { VendorDetailPage } from "./VendorDetailPage";
import { VendorsPage } from "./VendorsPage";

export const routes: RouteObject[] = [
  { path: "bills", element: <BillsPage /> },
  { path: "bills/new", element: <NewBillPage /> },
  { path: "bills/vendors", element: <VendorsPage /> },
  { path: "bills/vendors/new", element: <NewVendorPage /> },
  { path: "bills/vendors/:id", element: <VendorDetailPage /> },
  { path: "bills/:id", element: <BillDetailPage /> },
];
