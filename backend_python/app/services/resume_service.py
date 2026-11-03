from io import BytesIO
from pypdf import PdfReader
from docx import Document

def extract_text(filename, content):
    if filename.lower().endswith('.pdf'):
        return '\n'.join(page.extract_text() or '' for page in PdfReader(BytesIO(content)).pages)
    if filename.lower().endswith('.docx'):
        doc=Document(BytesIO(content)); return '\n'.join(p.text for p in doc.paragraphs)
    raise ValueError('Only PDF and DOCX resumes are accepted.')
