
import { Loader2 } from 'lucide-react';

interface ProcessingModalProps {
  message?: string;
}

export default function ProcessingModal({ message = '処理中です...' }: ProcessingModalProps) {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: 'white',
        color: '#333',
        padding: '2rem 3rem',
        borderRadius: '8px',
        textAlign: 'center',
        boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Loader2 size={24} className="loading-spin" />
          <p style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{message}</p>
        </div>
      </div>
    </div>
  );
}
