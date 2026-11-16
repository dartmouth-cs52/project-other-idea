import { useLab } from "@/lab/lab";

// Only the shell and the most common buttons are translated. That's enough to
// test whether a guide copes when the labels it learned are in another language.

const es: Record<string, string> = {
  Home: "Inicio",
  Cards: "Tarjetas",
  Expenses: "Gastos",
  Spend: "Gastos",
  Reimbursements: "Reembolsos",
  Approvals: "Aprobaciones",
  Bills: "Facturas",
  Payables: "Cuentas por pagar",
  Vendors: "Proveedores",
  Accounting: "Contabilidad",
  Reports: "Informes",
  People: "Personas",
  Team: "Equipo",
  Policies: "Políticas",
  Budgets: "Presupuestos",
  Settings: "Configuración",
  Help: "Ayuda",
  Search: "Buscar",
  "Search…": "Buscar…",
  Notifications: "Notificaciones",
  "Sign out": "Cerrar sesión",
  Profile: "Perfil",
  Save: "Guardar",
  "Save changes": "Guardar cambios",
  Cancel: "Cancelar",
  Next: "Siguiente",
  Back: "Atrás",
  Export: "Exportar",
  Filter: "Filtrar",
  Filters: "Filtros",
  Columns: "Columnas",
  Delete: "Eliminar",
  Approve: "Aprobar",
  Reject: "Rechazar",
  "Issue card": "Emitir tarjeta",
  "New expense": "Nuevo gasto",
  Spending: "Gastos",
  Finance: "Finanzas",
  Company: "Empresa",
  "Switch workspace": "Cambiar espacio",
  "Keyboard shortcuts": "Atajos de teclado",
  "Mark all as read": "Marcar todo como leído",
};

const tables = { en: {} as Record<string, string>, es };

export function useT() {
  const locale = useLab((s) => s.locale);
  return (text: string) => tables[locale][text] ?? text;
}
