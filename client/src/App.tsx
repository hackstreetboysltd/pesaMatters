import { Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider, useSession } from "./session";
import { Home } from "./pages/Home";
import { Invest } from "./pages/Invest";
import { InvestDetail } from "./pages/InvestDetail";
import { Loans } from "./pages/Loans";
import { Login } from "./pages/Login";
import { Profile } from "./pages/Profile";
import { ReceiptPage } from "./pages/Receipt";
import { Transact } from "./pages/Transact";

export function App(): React.ReactElement {
  return (
    <SessionProvider>
      <AuthedApp />
    </SessionProvider>
  );
}

function AuthedApp(): React.ReactElement {
  const { member } = useSession();

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="app-frame">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Home />} />
          <Route path="/transact" element={<Transact />} />
          <Route path="/move" element={<Navigate to="/transact" replace />} />
          <Route path="/loans" element={<Loans />} />
          <Route path="/invest" element={<Invest />} />
          <Route path="/invest/new" element={<Navigate to="/invest" replace />} />
          <Route path="/invest/:id" element={<InvestDetail />} />
          <Route path="/ledger" element={<Navigate to="/" replace />} />
          <Route path="/you" element={<Profile />} />
          <Route path="/receipts/:id" element={<ReceiptPage />} />
          <Route path="*" element={<Navigate to={member !== null ? "/" : "/login"} replace />} />
        </Routes>
      </div>
    </>
  );
}
