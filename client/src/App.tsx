import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/Sidebar.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ConceptLabPage } from './pages/ConceptLabPage.js';
import { RevisionsPage } from './pages/RevisionsPage.js';
import { TimetablePage } from './pages/TimetablePage.js';
import { MistakeVaultPage } from './pages/MistakeVaultPage.js';
import { AnalyticsPage } from './pages/AnalyticsPage.js';
import { StudyTimerModal } from './components/StudyTimerModal.js';
import { QuizModal } from './components/QuizModal.js';
import { RevisionModal } from './components/RevisionModal.js';
import type { IRevisionSchedule } from './api/types.js';

export function App() {
  // Modal & Global Focus State
  const [activeTimer, setActiveTimer] = useState<{ topicId: string; topicName: string } | null>(null);
  const [activeQuiz, setActiveQuiz] = useState<{ topicId: string; topicName: string } | null>(null);
  const [activeRevision, setActiveRevision] = useState<IRevisionSchedule | null>(null);

  const handleStartSession = (topicId: string, topicName: string) => {
    setActiveTimer({ topicId, topicName });
  };

  const handleFinishSession = (result: { promptQuiz: boolean; topicId: string }) => {
    const finishedTopicName = activeTimer?.topicName || 'Topic';
    setActiveTimer(null);
    if (result.promptQuiz) {
      setActiveQuiz({ topicId: result.topicId, topicName: finishedTopicName });
    }
  };

  const handleOpenRevision = (revision: IRevisionSchedule) => {
    setActiveRevision(revision);
  };

  return (
    <BrowserRouter>
      <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-canvas)' }}>
        {/* Left Editorial Navigation Sidebar */}
        <Sidebar
          activeSession={
            activeTimer ? { topicName: activeTimer.topicName, elapsedMinutes: 1 } : null
          }
        />

        {/* Main Content Viewport */}
        <main style={{ flex: 1, minWidth: 0, overflowX: 'hidden' }}>
          <Routes>
            <Route
              path="/"
              element={
                <DashboardPage
                  onStartSession={handleStartSession}
                  onOpenRevision={handleOpenRevision}
                />
              }
            />
            <Route
              path="/topics"
              element={
                <ConceptLabPage
                  onStartSession={handleStartSession}
                  onLaunchQuiz={(id, name) => setActiveQuiz({ topicId: id, topicName: name })}
                />
              }
            />
            <Route
              path="/revisions"
              element={<RevisionsPage onOpenRevision={handleOpenRevision} />}
            />
            <Route path="/timetable" element={<TimetablePage />} />
            <Route path="/mistakes" element={<MistakeVaultPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
          </Routes>
        </main>

        {/* Global Modals */}
        {activeTimer && (
          <StudyTimerModal
            topicId={activeTimer.topicId}
            topicName={activeTimer.topicName}
            onClose={() => setActiveTimer(null)}
            onFinish={handleFinishSession}
          />
        )}

        {activeQuiz && (
          <QuizModal
            topicId={activeQuiz.topicId}
            topicName={activeQuiz.topicName}
            onClose={() => setActiveQuiz(null)}
            onCompleted={() => {
              // Quiz completed, trigger reload or notification
            }}
          />
        )}

        {activeRevision && (
          <RevisionModal
            revision={activeRevision}
            onClose={() => setActiveRevision(null)}
            onCompleted={() => {
              // Revision completed
            }}
          />
        )}
      </div>
    </BrowserRouter>
  );
}

export default App;
