//! N8N Agent Core - Schema-Driven Workflow Builder
//! 
//! This library provides strict schema validation for n8n workflow construction.

pub mod schema;
pub mod validator;
pub mod workflow;

pub use schema::NodeSchema;
pub use validator::ParameterValidator;
pub use workflow::WorkflowBuilder;
