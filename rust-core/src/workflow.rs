//! Workflow building and serialization

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowNode {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(rename = "typeVersion")]
    pub type_version: i32,
    pub position: [i32; 2],
    pub parameters: HashMap<String, serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credentials: Option<HashMap<String, serde_json::Value>>,
    #[serde(rename = "webhookId", skip_serializing_if = "Option::is_none")]
    pub webhook_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionTarget {
    pub node: String,
    #[serde(rename = "type")]
    pub conn_type: String,
    pub index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeConnections {
    pub main: Vec<Vec<ConnectionTarget>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    pub name: String,
    pub nodes: Vec<WorkflowNode>,
    pub connections: HashMap<String, NodeConnections>,
    pub active: bool,
    pub settings: HashMap<String, serde_json::Value>,
    #[serde(rename = "versionId")]
    pub version_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowState {
    pub nodes: Vec<WorkflowNode>,
    pub connections: HashMap<String, NodeConnections>,
}

pub struct WorkflowBuilder {
    nodes: Vec<WorkflowNode>,
    connections: HashMap<String, NodeConnections>,
    state_file: String,
}

impl WorkflowBuilder {
    pub fn new(state_file: &str) -> Self {
        let mut builder = Self {
            nodes: Vec::new(),
            connections: HashMap::new(),
            state_file: state_file.to_string(),
        };
        builder.load_state();
        builder
    }
    
    fn load_state(&mut self) {
        if let Ok(content) = fs::read_to_string(&self.state_file) {
            if let Ok(state) = serde_json::from_str::<WorkflowState>(&content) {
                self.nodes = state.nodes;
                self.connections = state.connections;
            }
        }
    }
    
    fn save_state(&self) {
        let state = WorkflowState {
            nodes: self.nodes.clone(),
            connections: self.connections.clone(),
        };
        if let Ok(content) = serde_json::to_string_pretty(&state) {
            let _ = fs::write(&self.state_file, content);
        }
    }
    
    pub fn reset(&mut self) {
        self.nodes.clear();
        self.connections.clear();
        self.save_state();
    }
    
    pub fn add_node(
        &mut self,
        node_type: &str,
        name: &str,
        parameters: HashMap<String, serde_json::Value>,
        type_version: i32,
        position: [i32; 2],
    ) -> &WorkflowNode {
        let mut node = WorkflowNode {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            node_type: node_type.to_string(),
            type_version,
            position,
            parameters,
            credentials: None,
            webhook_id: None,
        };
        
        // Add webhook ID for webhook nodes
        if node_type == "n8n-nodes-base.webhook" {
            node.webhook_id = Some(format!("{:08x}", rand::random::<u32>()));
        }
        
        self.nodes.push(node);
        self.save_state();
        self.nodes.last().unwrap()
    }
    
    pub fn connect(
        &mut self,
        from_node: &str,
        to_node: &str,
        output_index: usize,
        input_index: usize,
    ) -> Result<(), String> {
        // Verify nodes exist
        if !self.nodes.iter().any(|n| n.name == from_node) {
            return Err(format!("Source node not found: {}", from_node));
        }
        if !self.nodes.iter().any(|n| n.name == to_node) {
            return Err(format!("Target node not found: {}", to_node));
        }
        
        let connection = self.connections
            .entry(from_node.to_string())
            .or_insert(NodeConnections { main: Vec::new() });
        
        // Ensure we have enough output slots
        while connection.main.len() <= output_index {
            connection.main.push(Vec::new());
        }
        
        connection.main[output_index].push(ConnectionTarget {
            node: to_node.to_string(),
            conn_type: "main".to_string(),
            index: input_index,
        });
        
        self.save_state();
        Ok(())
    }
    
    pub fn save<P: AsRef<Path>>(&self, path: P, name: &str) -> Result<(), String> {
        let workflow = Workflow {
            name: name.to_string(),
            nodes: self.nodes.clone(),
            connections: self.connections.clone(),
            active: false,
            settings: HashMap::new(),
            version_id: "1".to_string(),
        };
        
        let content = serde_json::to_string_pretty(&workflow)
            .map_err(|e| format!("Failed to serialize workflow: {}", e))?;
        
        fs::write(path, content)
            .map_err(|e| format!("Failed to write workflow file: {}", e))?;
        
        Ok(())
    }
    
    pub fn list_nodes(&self) -> &[WorkflowNode] {
        &self.nodes
    }
}

// Temporary rand implementation for webhook IDs
mod rand {
    pub fn random<T: Default>() -> T {
        T::default()
    }
}
