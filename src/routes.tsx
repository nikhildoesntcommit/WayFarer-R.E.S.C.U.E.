import { Route, Routes } from 'react-router-dom';
import { Home } from './Home';
import { HelpPage } from './HelpPage';
import { SettingsRoute } from './SettingsRoute';
import { CameraCapture } from './scan/CameraCapture';
import { CalibrateStage } from './scan/CalibrateStage';
import { LayoutEditor } from './draw/LayoutEditor';
import { DisasterSetup } from './map/DisasterSetup';
import { MapSimulateStage } from './map/MapSimulateStage';
import { MarkingStage } from './marking/MarkingStage';
import { SimulationStage } from './simulation/SimulationStage';
import { ResultsStage } from './results/ResultsStage';
import { ReportStage } from './report/ReportStage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/settings" element={<SettingsRoute />} />
      <Route path="/scan" element={<CameraCapture />} />
      <Route path="/calibrate" element={<CalibrateStage />} />
      <Route path="/draw" element={<LayoutEditor />} />
      <Route path="/map" element={<DisasterSetup />} />
      <Route path="/map-simulate" element={<MapSimulateStage />} />
      <Route path="/mark" element={<MarkingStage />} />
      <Route path="/simulate" element={<SimulationStage />} />
      <Route path="/results" element={<ResultsStage />} />
      <Route path="/whatif" element={<ResultsStage whatIfOpen />} />
      <Route path="/report" element={<ReportStage />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
