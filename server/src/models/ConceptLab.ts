import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ICodeSnippet {
  language: string; // "python" | "cpp" | "typescript" | "java"
  code: string;
  title: string;
}

export interface IConceptLab extends Document {
  userId: Types.ObjectId;
  topicId: Types.ObjectId;
  intuition: string; // Markdown
  complexity: {
    time: string;
    space: string;
    explanation: string;
  };
  codeSnippets: ICodeSnippet[];
  personalNotes: string; // Markdown with LaTeX support
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const ConceptLabSchema = new Schema<IConceptLab>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', required: true, unique: true, index: true },
    intuition: { type: String, default: '' },
    complexity: {
      time: { type: String, default: 'O(N)' },
      space: { type: String, default: 'O(1)' },
      explanation: { type: String, default: '' },
    },
    codeSnippets: [
      {
        language: { type: String, required: true },
        code: { type: String, required: true },
        title: { type: String, default: 'Canonical Implementation' },
      },
    ],
    personalNotes: { type: String, default: '' },
    tags: { type: [String], default: [] },
  },
  { timestamps: true }
);

export const ConceptLab = mongoose.model<IConceptLab>('ConceptLab', ConceptLabSchema);
